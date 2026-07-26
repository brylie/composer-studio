# Command History (Undo/Redo) Specification

## Overview

Transformations are **destructive with undo** — a command mutates notes on the
timeline directly rather than layering non-destructive edits over a separate
"motif" container. This matches how the piano roll already works and keeps the
data model simple (a `Note[]`, not a `Note[]` plus a stack of pending
transforms per motif).

`store.svelte.ts` already implements a working version of this: snapshot the
note array before a mutation, push it to an undo stack, clear the redo stack.
This spec generalises that pattern so it can back every domain added later
(scale events, chord events, arranger sections), not just notes, and fixes one
reactivity gap in the current implementation.

---

## The reactivity gap in the current implementation

```typescript
// current store.svelte.ts
const undoStack: Note[][] = [];
const redoStack: Note[][] = [];
```

These are plain arrays, not `$state`. Nothing reading `undoStack.length` (e.g.
a ribbon Undo button's disabled state) will react when `push`/`pop` mutate
them — the button would only happen to update when *something else* also
re-renders. The fix is to declare them with `$state`, which Svelte proxies
deeply enough to detect `push()`/`pop()`:

```typescript
let undoStack: DocumentSnapshot[] = $state([]);
let redoStack: DocumentSnapshot[] = $state([]);

let canUndo = $derived(undoStack.length > 0);
let canRedo = $derived(redoStack.length > 0);
```

---

## Generalising beyond `Note[]`

Once scale/chord/arranger tracks exist, a single command might touch notes
*and* a scale event in the same user action (rare, but possible for something
like re-harmonization that also nudges a chord event). Snapshotting only
`Note[]` won't cover that. Generalise the snapshot to a document-level shape:

```typescript
interface DocumentSnapshot {
	label: string; // "Transpose +2", "Invert around C4" — shown on the Undo button / future history panel
	notes: Note[];
	// scaleEvents, chordEvents, arrangerSections added here as those tracks land
}
```

Whole-document snapshotting (vs. per-field diffing) is the deliberate
trade-off: it costs more memory per undo step, but every command's undo logic
is identical ("restore the snapshot") regardless of what it touched — no
per-command undo code to get wrong. For a piano-roll-scale document this is
cheap enough not to matter; revisit only if profiling says otherwise.

---

## API

```typescript
class CommandHistory {
	#undoStack: DocumentSnapshot[] = $state([]);
	#redoStack: DocumentSnapshot[] = $state([]);
	#maxDepth = 50;

	canUndo = $derived(this.#undoStack.length > 0);
	canRedo = $derived(this.#redoStack.length > 0);

	// call BEFORE mutating, with a human-readable label for the action about to happen.
	// `snapshot` MUST return plain data — e.g. `() => ({ notes: $state.snapshot(store.notes) })` —
	// not a live `$state` proxy read directly (`() => ({ notes: store.notes })`).
	// `structuredClone` throws `DataCloneError` on a raw Svelte state proxy;
	// `$state.snapshot()` is what turns reactive state into the plain,
	// already-independent value structuredClone can actually work with. This
	// is the caller's responsibility, not something `record()` can detect or
	// fix on its own — it has no way to tell a proxy from a plain object
	// short of the clone already failing.
	record(label: string, snapshot: () => Omit<DocumentSnapshot, 'label'>) {
		// label comes from the parameter, not from whatever (if anything) the
		// snapshot callback's own return value happens to carry — there's
		// exactly one place a stored entry's label is decided.
		// structuredClone so a later live-state mutation can't reach back into
		// an already-recorded entry through a shared array/object reference.
		this.#undoStack.push(structuredClone({ ...snapshot(), label }));
		this.#redoStack.length = 0;
		if (this.#undoStack.length > this.#maxDepth) this.#undoStack.shift();
	}

	// `current` has the same plain-data contract as `snapshot` above.
	undo(current: () => Omit<DocumentSnapshot, 'label'>): DocumentSnapshot | undefined {
		const entry = this.#undoStack.pop();
		if (!entry) return;
		// Redo re-applies the same named action, so the entry pushed here
		// carries the popped entry's own label, not a new/different one.
		this.#redoStack.push(structuredClone({ ...current(), label: entry.label }));
		return entry;
	}

	redo(current: () => Omit<DocumentSnapshot, 'label'>): DocumentSnapshot | undefined {
		const entry = this.#redoStack.pop();
		if (!entry) return;
		this.#undoStack.push(structuredClone({ ...current(), label: entry.label }));
		return entry;
	}
}
```

`snapshot()`/`current()` only need to capture the data fields (`notes`, and
scale/chord/arranger events once those tracks land) — the label is always
supplied by whichever method is doing the recording, never embedded in the
callback's own return value, so there's no second, competing source of
truth for it.

This keeps `CommandHistory` ignorant of *what* a document is — it just stores
and returns snapshots. The editor store owns applying a returned snapshot back
onto its own `$state` fields (notes, selection filtering, etc.), exactly as
`undo()`/`redo()` do today in `store.svelte.ts`.

---

## One history entry per gesture

A drag that moves a note across 40 pixels must not create 40 undo steps. The
invariant: **exactly one `record()` call per discrete user action**, whether
that action is a single ribbon-button click (transpose) or a full
mousedown→drag→mouseup gesture (move note). Concretely:

- Ribbon/palette commands: `record()` once, immediately before `run()`
  mutates state.
- Grid drag gestures: `record()` once on gesture start (mousedown/pointerdown),
  not per pointermove.

---

## Command labels feed the UI, not just history

Every entry in the [command registry](./transformations.md) supplies a label
used both for the `DocumentSnapshot.label` above and for a future
Photoshop/Figma-style history list — one field serves both, so there's no
separate "undo description" to keep in sync.

---

## Keyboard shortcuts

Already listed as planned in [piano-roll.md](./piano-roll.md#keyboard-shortcuts-planned):
`Ctrl+Z` (undo), `Ctrl+Y` or `Ctrl+Shift+Z` (redo — support both, since both
conventions are common). See [ribbon.md](./ribbon.md#keyboard-shortcuts) for
how shortcut registration avoids colliding with browser/OS bindings.

---

## State ownership

`CommandHistory` is created inside the root context provider alongside
`store` and read via a getter, not imported as a bare module singleton — see
[state-ownership.md](./state-ownership.md) for the root-provided-context
pattern and why it replaced the singleton default.
