# Editing Model Specification

## Overview

Note creation, deletion, move, and resize are already implemented
(`store.svelte.ts`'s `addNote`/`removeNote`/`updateNote`/`clearNotes`) and
already have gestures specified in
[piano-roll.md](./piano-roll.md#note-grid--main-scrollable-canvas) and
[selection.md](./selection.md#mode-based-interaction-semantics). What's
missing is the **contract** those gestures, plus every transform command's
`run()` and paste, are implicitly relying on — the invariants that keep a
`Note` valid regardless of which of the many call sites produced it. This
document is that contract, not a new UI surface.

---

## `updateNote` is the one mutation primitive

`store.svelte.ts` already generalizes move/resize/velocity-change into a
single `updateNote(id, updates: Partial<Note>)`. This spec doesn't add
`moveNote`/`resizeNote`/`setVelocity` as separate store methods — that would
just be three thin wrappers duplicating `updateNote`. Instead, the
invariants below apply to **every** call to `updateNote` (and `addNote`),
regardless of whether the caller is a drag gesture, a paste operation, or a
transform command's `run()`.

```typescript
function addNote(note: Note): void; // existing
function updateNote(id: string, updates: Partial<Note>): void; // existing
```

---

## Invariants every mutation must uphold

| Field | Rule |
| --- | --- |
| `midiNote` | Clamped to `[MIN_MIDI, MAX_MIDI]` (36–107). A drag naturally can't exceed this since there's nothing rendered beyond it, but **programmatic** mutations (transpose, invert, jitter) must clamp explicitly — nothing currently states this for [`transpose`](./transformations.md#transform) |
| `startBeat` | Clamped to `>= 0` |
| `durationBeats` | Minimum one snap unit (`snapBeats`) — existing behavior for drag-resize, applies equally to any command that sets duration (augmentation, diminution) |
| `velocity` | Clamped to `[1, 127]` |
| Grid-gesture positions | Snapped to `snapBeats`/semitone as today. **Non-gesture writers are exempt** — pasted notes preserve their exact relative offset from the clipboard rather than being re-snapped (see [selection.md](./selection.md#clipboard-copypaste)), and `jitter` ([transformations.md](./transformations.md)) exists specifically to produce sub-snap positions. Snapping is an input-gesture behavior, not a stored-data constraint — consistent with [timeline.md](./timeline.md#continuous-beats-not-a-fixed-step-grid) |

### Overlap policy: notes may overlap freely

Including two notes at the same pitch with overlapping time ranges. No
automatic trimming, no blocking. This matches conventional piano-roll
behavior (Ableton, Logic, FL Studio all allow it) and requires no special
handling in the audio engine, which already schedules each note
independently rather than assuming monophony per pitch. This holds
regardless of layer, too: [layers.md](./layers.md#rendering-and-interaction-rules)'s
top-layer-wins-on-overlap rule only affects which note renders on top in the
grid — both still play, layers never trim or block on the audio side.

### `totalBeats` auto-extends

If a create, move, resize, or paste would place a note (or its end) beyond
the current `totalBeats`, `totalBeats` extends to fit — snapped up to the
next full bar — rather than clipping the note or silently leaving it beyond
the visible/loopable range. This keeps "just keep playing/writing past the
end" from being a dead end.

---

## Multi-select resize: v1 default

[selection.md](./selection.md#mode-based-interaction-semantics) already
specifies that dragging a selected note's **body** moves the whole
selection. Dragging a selected note's **resize handle** is different: it
resizes **only that note**, even within a multi-selection. Proportional or
uniform multi-resize is genuinely ambiguous (delta in beats? ratio? anchored
at which end?) and not an obvious default — a future batch "set duration"
action can cover the uniform case explicitly rather than overloading drag
with a guessed default.

---

## Note inspector: precise numeric entry

Every edit specified so far is drag-based, which conflicts with continuous
(non-quantized) beats being the canonical position ([timeline.md](./timeline.md#continuous-beats-not-a-fixed-step-grid))
— there's no way to type an exact value (e.g. "start at beat 4.3125" for a
specific swing feel). Rather than invent a new surface, extend the one
already specified:

- **Touch**: the long-press bottom sheet
  ([piano-roll.md](./piano-roll.md#note-interactions--touch-draw-grid-mode))
  generalizes from "adjust velocity, duplicate, delete" to a small inspector
  with numeric fields for pitch, start, duration, and velocity, plus
  duplicate/delete.
- **Desktop**: double-click a note opens the same inspector (a new gesture,
  since double-click isn't otherwise claimed — single-click selects, drag
  moves/resizes, right-click deletes).

Both render the same inspector component, same motivation as the ribbon's
shared `CommandParamsForm` — one form, two entry points.

---

## Duplicate-in-place ("repeat this phrase")

Distinct from copy/paste ([selection.md](./selection.md#clipboard-copypaste)),
which re-anchors pasted notes to the current playhead. Duplicating a phrase
**immediately after itself** — a common composition move (repeat this two-bar
idea back-to-back) — needs its own operation:

```typescript
function duplicateSelection(): void {
	// copies selected notes, offsetting startBeat by ctx.beatRange's span
	// (SelectionContext, per selection.md), selects the new copies
}
```

Same auto-select-the-result behavior as paste, for the same reason: the
duplicated phrase is very likely the next thing you want to transform
(transpose the repeat up a third, invert it, etc.). Belongs in the registry
as a `transform`-or-`generate`-category command (`duplicate-selection`) so
it's reachable from the ribbon and palette like anything else in
[transformations.md](./transformations.md), rather than a one-off button.

---

## Future Work

- Batch velocity editing across a selection (ramps/crescendos) — the
  velocity lane is already marked "planned" in piano-roll.md; multi-note
  batch editing beyond single-note drag is a further step past that
- Split/merge note operations (cut one note into two at a point; merge two
  adjacent same-pitch notes) — not core, not currently requested
