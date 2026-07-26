# Selection Specification

## Overview

Every transformation (transpose, invert, retrograde, ...) acts on a selection.
`store.svelte.ts` already has a minimal version of this (`selectedNoteIds: string[]`,
click-to-select, ctrl-click-to-toggle, select all). This spec extends it to cover
marquee/bounding-box selection, range selection, mobile interaction, and — most
importantly — the shape that [transformations.md](./transformations.md) needs to
decide whether a command is applicable.

---

## Data model

### Migrate `selectedNoteIds` to a `SvelteSet`

The current implementation stores selection as a plain `string[]` and does
`Array.includes` / `Array.filter` for membership and toggling. Svelte 5 ships a
reactive `SvelteSet` (from `svelte/reactivity`) built for exactly this — O(1)
`has()`/`add()`/`delete()`, and it's reactive on iteration/`size`/membership
without needing `[...array]` copies to trigger updates:

```typescript
import { SvelteSet } from 'svelte/reactivity';

let selectedNoteIds = new SvelteSet<string>();
```

This is a drop-in improvement to the existing store, not a new concept — worth
doing as part of implementing this spec rather than carrying the array forward.
It isn't a one-line change, though: every method that currently reassigns
`selectedNoteIds` as a new array — `removeNote`, `undo`, `redo`, `selectNote`,
`selectNotes`, `selectAll`, `deselectAll`, and `deleteSelected` in
`store.svelte.ts` — needs its `.filter()`/spread logic rewritten to
`.add()`/`.delete()`/`.clear()` calls on the set, since those are mutations,
not reassignments. `NoteGrid.svelte` reads `store.selectedNoteIds` directly
in a few places (`.length`, `.includes(noteId)`) that become `.size`/`.has()`
on a `SvelteSet` — there's no array-shaped consumer left once this migrates,
so no adapter layer is needed to bridge the two; every touch point moves to
`Set` semantics together, in the same change.

### Selection is ephemeral — not part of undo/redo

Selection is UI working state, not document state: it doesn't describe the
composition, it describes what you're currently looking at within it. It is
**not** included in [`DocumentSnapshot`](./command-history.md), and undoing
or redoing a note-mutating command does not restore whatever was selected at
that point in history. What already happens in `store.svelte.ts` — filtering
`selectedNoteIds` down to whatever ids still exist in the notes returned by
`undo()`/`redo()`, dropping ids for notes a redo/undo just removed — is the
right behavior and stays as-is: it's just the selection reacting to the
notes it references changing out from under it, the same way it already
reacts to a `deleteNote()` call, not a form of selection persistence to
preserve deliberately.

### Anchor/focus, for range selection

Shift-click range-select needs to remember where a selection gesture started:

```typescript
interface SelectionAnchor {
	noteId: string;
	// index into the time-then-pitch sorted note order at the moment
	// the anchor was set, so a later shift-click can select the range between them
}
```

### SelectionContext — what transformations actually read

This is the object every `CommandDescriptor.isApplicable()` and `.run()` in
[transformations.md](./transformations.md) receives. It's derived, not stored:

```typescript
interface SelectionContext {
	notes: Note[]; // selected notes, sorted by startBeat then midiNote
	count: number;
	pitchRange: { min: number; max: number } | null;
	beatRange: { start: number; end: number } | null;
	isContiguous: boolean; // the union of note intervals has no gaps — see below, NOT a naive pairwise check
	activeScales: ActiveScaleSegment[]; // see below
	activeLayers: Layer[]; // distinct layers referenced by `notes` — see layers.md
}
```

```typescript
const selectionContext = $derived.by((): SelectionContext => {
	const notes = store.notes
		.filter((n) => selectedNoteIds.has(n.id))
		.sort((a, b) => a.startBeat - b.startBeat || a.midiNote - b.midiNote);
	// ...derive count / pitchRange / beatRange / isContiguous / activeScales
});
```

#### `isContiguous`: union coverage, not consecutive-pair comparison

A naive "does `notes[i].endBeat === notes[i + 1].startBeat`?" check breaks as
soon as one selected note fully covers a shorter one that sorts right after
it — e.g. a 10-beat-long note from beat 0, a short 2-beat note nested inside
it starting at beat 2, then a third note starting exactly at beat 10.
Sorted by `startBeat`, the pairwise check compares the first note's `endBeat`
(10) against the *second* note's `startBeat` (2) and reports a gap, even
though the three notes' combined time coverage is one unbroken span from 0
to past the third note's start. The correct definition evaluates the union
of intervals instead — track the greatest `endBeat` seen so far while
walking the sorted notes, and only count a gap when the next note's
`startBeat` exceeds that running maximum, not merely its immediate
predecessor's `endBeat`:

```typescript
function isContiguous(notes: Note[]): boolean {
	let coveredUntil = -Infinity;
	for (const note of notes) {
		if (note.startBeat > coveredUntil) {
			if (coveredUntil !== -Infinity) return false; // a real gap, not just the first note
		}
		coveredUntil = Math.max(coveredUntil, note.startBeat + note.durationBeats);
	}
	return true;
}
```

Overlapping and touching notes both stay contiguous under this definition,
including the covering-note case above — only a genuine gap in the union
(no selected note reaches up to where the next one starts) counts.

Each transformation declares its own minimum-selection rule against this shape
(e.g. retrograde needs `count >= 1`, a chord-aware re-harmonization might need
`count >= 2`) — the *rule* lives with the command, not here. This module only
guarantees the shape is accurate and reactive.

#### `activeScales`: selections aren't bounded by scale boundaries

A selection can span a scale change on the timeline — nothing stops the user
from marquee-selecting across a point where a new `ScaleEvent` takes effect.
An earlier draft of this shape had a single `activeScale: ScaleEvent | undefined`
read at the selection's start beat, which is wrong whenever that happens: it
silently reports only the first scale and ignores the rest of the selection.

```typescript
interface ActiveScaleSegment {
	scale: ScaleEvent;
	start: number; // beats — clamped to the selection's own beatRange, not the scale event's full span
	end: number; // beats — likewise clamped; Infinity-until-next-event becomes "until selection end" here
}
```

`activeScales: ActiveScaleSegment[]` is the selection's beat range sliced at
every scale-track boundary it crosses, each slice clamped to the selection's
own bounds (not the underlying `ScaleEvent`'s full extent on the timeline).
A selection entirely within one scale produces a single-element array — the
common case stays simple to consume (`ctx.activeScales[0]?.scale`).

This is intentionally the only place boundary-crossing is modeled today.
Individual notes are **not** split or dual-colored where they straddle a
scale boundary — that's real future work (per-note, even sub-note, coloring
by scale/chord degree or tension, where a single sustained note could show
split coloring across the boundary) worth keeping in mind precisely because
`activeScales` already carries the boundary information such a feature would
need, but building the note-splitting UI now would be solving a problem no
command currently has. Scale-aware commands (`mode-shift`, `reharmonization`)
should decide for themselves how to treat a multi-segment selection (e.g.
apply per-segment, or require `activeScales.length === 1` and report
inapplicable otherwise) rather than this module picking a policy for them.

#### `activeLayers`: selection spans layers freely, by design

Unlike `activeScales`, this isn't fixing a bug in an earlier draft — it's a
deliberate requirement. [layers.md](./layers.md) introduces instruments as
layers over one shared `Note[]` collection specifically so a multi-voice
selection (e.g. soprano + alto in a choral texture) can be selected,
transposed, copied, and pasted as one gesture, the same as any other
selection — a selection was never going to be restricted to one layer.
`activeLayers` is simply the deduplicated set of layers referenced by
`notes`, in panel/z-order, with no clamping or slicing needed (a note either
belongs to a layer or it doesn't — no partial membership like a beat range
crossing a scale boundary).

Layer visibility and lock gate what can be selected **before** a note ever
reaches this shape, not inside it: marquee-select and click only hit-test
notes on visible, unlocked layers (see
[layers.md](./layers.md#rendering-and-interaction-rules)), so `activeLayers`
never ends up containing a locked or hidden layer as a byproduct of how the
selection was made — this module doesn't need its own filtering rule for
that.

---

## Selection modes

| Gesture                          | Result                                                        | Status               |
| --------------------------------- | -------------------------------------------------------------- | --------------------- |
| Click a note                      | Replace selection with that note                               | Exists                |
| Ctrl/Cmd+click a note              | Toggle that note in/out of selection                            | Exists                |
| Shift+click a note                 | Select the range between the anchor and the clicked note        | New                    |
| Drag on empty grid space           | Marquee (bounding-box) select — rectangle intersect vs. note rects in beat/pitch space | New |
| Ctrl/Cmd+A                          | Select all — visible, unlocked layers only (see [layers.md](./layers.md)) | Exists |
| Escape / click empty space         | Deselect all                                                   | Exists (click only)   |

### Marquee selection

Rectangle drawn in screen space is converted to a `{ beatRange, pitchRange }`
in the same coordinate system as `SelectionContext.beatRange`/`pitchRange`, then
intersected against every note's `[startBeat, startBeat + durationBeats)` ×
`midiNote`. Notes fully or partially inside the rectangle are selected —
partial-overlap-counts is the more forgiving default and matches most DAWs.

**v1: bounded to the visible viewport, no auto-scroll.** Dragging a marquee
past the edge of the currently-scrolled grid does not scroll the grid to
extend the selection — the rectangle clips at the viewport edge, same as the
screen-space rectangle simply can't extend past what's drawn. Auto-scroll
(scrolling the grid while a marquee drag holds near an edge, common in
desktop DAWs) is a real UX improvement but adds real complexity — a scroll
loop tied to pointer position, interacting with both axes' independent
scroll/zoom state — that isn't justified for v1. Revisit for v2 once the
core selection/transform workflow is in use and viewport size in practice
shows this is actually a friction point.

### Touch/mobile: draw vs. select mode

Drag-on-empty-space already means "create a note" in the current grid. On
touch there's no ctrl/shift modifier to disambiguate a marquee drag from a
note-creation drag. Rather than guess from gesture speed/shape, expose an
explicit mode toggle:

```typescript
type GridInteractionMode = 'draw' | 'select';
```

- **Desktop** defaults to `'draw'`, with ctrl/shift modifiers layered on top
  (no mode switch needed — modifier keys disambiguate).
- **Touch** requires an explicit toggle (a button in the ribbon's quick-access
  bar or the piano-roll toolbar) since modifier keys aren't reliably
  available. This mirrors the "select tool vs. draw tool" pattern from
  image editors rather than inventing a novel touch gesture.

---

## Mode-based interaction semantics

`GridInteractionMode` (`'draw' | 'select'`, introduced above for the touch
case) actually determines the meaning of *every* tap/click and drag in the
grid, on both desktop and touch — it's not touch-only. Desktop layers
modifier keys on top of `'draw'` mode rather than requiring an explicit mode
switch; touch requires the switch since it has no modifiers.

| Gesture                    | `'draw'` mode                          | `'select'` mode                                  |
| --------------------------- | ---------------------------------------- | --------------------------------------------------- |
| Tap/click empty space        | Create note                             | Start a lasso (marquee) rectangle                   |
| Tap/click existing note      | Delete note (touch) / select (desktop, see note below) | Toggle that note in/out of selection |
| Drag from empty space        | Pans the grid (touch) / draws a note, dragging sets its initial duration (desktop, unmodified — per [piano-roll.md](./piano-roll.md#note-grid--main-scrollable-canvas)); ctrl/shift+drag marquee-selects instead, same modifier-layered-on-`'draw'` pattern as click | Lasso select |
| Drag an existing note        | Move note                               | Move the *entire current selection* (if the dragged note is already selected) or replace-and-move (if not) |

Desktop's "tap existing note" behavior differs from touch by necessity: a
desktop click on a note selects it (so a subsequent drag can move it),
matching the existing `store.svelte.ts` `selectNote()` — desktop never
needed touch's tap-to-delete affordance because right-click already covers
delete. Touch collapses select-then-delete into a single tap for existing
notes (per [piano-roll.md](./piano-roll.md#note-grid--main-scrollable-canvas))
specifically because it lacks a delete-only gesture, and long-press covers the
cases (adjust, duplicate) that would otherwise need a second gesture.

---

## Clipboard (copy/paste)

An in-memory clipboard, scoped to the current session (not the OS clipboard —
cross-app paste isn't a goal here):

```typescript
interface ClipboardContents {
	notes: Note[]; // positions stored relative to the earliest selected startBeat; layerId preserved as-is
}
```

- **Copy**: snapshots the currently selected notes into `ClipboardContents`,
  normalizing `startBeat` so the earliest copied note is at `0`. Each note's
  `layerId` is copied verbatim — a multi-layer selection (e.g. soprano +
  alto) stays split across the same layers in the clipboard.
- **Paste**: inserts the clipboard's notes at the current playhead beat
  (`pastedNote.startBeat = clipboardNote.startBeat + currentBeat`), assigns
  fresh ids, keeps each note on its original `layerId` (falling back to the
  active layer if that layer was deleted between copy and paste — see
  [layers.md](./layers.md#clipboard-preserve-layer-membership-across-copypaste)),
  and **replaces the current selection with the newly pasted
  notes** — this is deliberate, not incidental: it means paste-then-transform
  (paste a phrase, immediately hit Transpose or Retrograde on it) works
  without an extra selection step, which is exactly the "create variations on
  selected notes" workflow this whole command system exists for.
- Paste is one [history](./command-history.md) entry, same as any other
  mutating action.

---

## Keyboard navigation (later milestone)

Arrow keys moving a selection cursor and Shift+Arrow extending it are valuable
but not required for the initial pass — flagged here so the data model
(anchor/focus above) doesn't need to change when it's added later.

---

## Open questions

None outstanding — the two open questions this document previously carried
(marquee auto-scroll; selection lifetime across undo/redo) are resolved
above, in [Marquee selection](#marquee-selection) and
[Selection is ephemeral](#selection-is-ephemeral--not-part-of-undoredo)
respectively.
