# Timeline Specification

## Overview

The timeline is the shared spine that every editable surface — the note grid, the
scale track, the (future) chord track, and the (future) arranger track — positions
itself against. Today this exists only implicitly inside the piano roll (`totalBeats`,
`pixelsPerBeat`, a single global `tempo`). This document formalises it into a
standalone concept so new track types can be added without re-deriving time math.

**Goal:** one authoritative beat/bar/tick coordinate system, and one generic
"event track" abstraction, that every domain (notes, scale, chords, arrangement)
reads from and writes to.

---

## Coordinate system

| Unit | Meaning                                | Notes                                              |
| ---- | -------------------------------------- | -------------------------------------------------- |
| Beat | Quarter-note beat, canonical unit      | Already used throughout `piano-roll` (`startBeat`) |
| Bar  | Derived from the active time signature | Not currently modelled — see below                 |
| Tick | 480 ticks / quarter note               | Only used at MIDI export time (`midi-export.ts`)   |

Beats remain the canonical unit for all in-memory state. Bars are a _display and
snapping_ concept derived from the time-signature track, not stored on events.
Ticks only exist at the MIDI-export boundary.

### Time signature is currently hardcoded

`NoteGrid.svelte` draws a bar line every 4 beats — i.e. 4/4 is implicit. This
spec generalises time signature into an event track (below) so a change to 3/4
partway through a piece is representable, the same way a scale change is. The
track's own input UI, preset vocabulary, grid effects beyond the bar line, and
its interaction with the snap grid are specified in full in
[tracks.md](./tracks.md#time-signature-track-specified) — this section covers
only the coordinate-system motivation and the data model below.

### Continuous beats, not a fixed step grid

An earlier prototype of this app used a fixed 16th-note step grid as the
canonical unit (all positions integers 0–255 for a 64-beat/16-bar timeline)
rather than continuous beats. This spec deliberately keeps continuous
floating-point beats as canonical instead, and treats "snap" purely as an
editing aid layered on top — the existing `snapBeats = 4 / snapDenominator`
already works this way. The reason: `jitter`
([transformations.md](./transformations.md)) and other humanization-style
transforms need to nudge notes _off_ the grid by sub-snap amounts, which an
always-quantized integer-step model can't represent without a parallel
"micro-timing offset" field bolted on. Continuous beats support that natively
— a note's position is just a number, snap or no snap.

### Resolution: unlimited in storage, a UI concern at the snap grid

Because beats are continuous floats, "resolution" is not a data-model limit
— it's entirely a property of whatever's writing the number. A quarter note
is `1.0`, an eighth is `0.5`, a sixteenth is `0.25`, and a triplet eighth is
`1/3`: all equally representable, today, with no change needed here. What
_is_ currently limited is the snap-grid UI: `SnapDenominator` is
`1 | 2 | 4 | 8 | 16` ([types.ts](../../src/lib/piano-roll/types.ts)), a
straight power-of-two series with no triplet or other non-binary division.
That's a small, additive UI gap, not an architectural one — worth tracking
as future work rather than solving now:

- **Triplet divisions** (`snapBeats = 4/3, 2/3, 1/3, ...` for quarter-note,
  eighth-note, sixteenth-note triplets) — just more entries in the same snap
  picker, no new concept. Standard in every DAW's snap/quantize UI.
- **Polymetric/polyrhythmic quantization** — snapping different selections
  or tracks to _different_ divisions of the beat at once (e.g. a 3-against-2
  cross-rhythm), which is a real generative/compositional technique — the
  `euclidean-rhythm` generator in [transformations.md](./transformations.md)
  already produces non-binary groupings. This is more than a snap-picker
  addition — it's
  closer to a per-command quantization parameter (`quantizeDenominator`,
  passed to a command's `params`, per
  [transformations.md](./transformations.md)) than a single global grid
  setting, since two overlapping polymetric parts can't share one snap value.
  Flagged here as a real future direction, not specified further until a
  concrete command needs it.

The only actual quantization floor in the system is MIDI export's
480-ticks-per-quarter-note resolution (~1/1920 of a beat) — far finer than
any snap or triplet division above, so nothing generated at any of these
resolutions is lost on export.

This mirrors how mainstream DAWs (Ableton, Logic, Cubase) already work:
position is stored as a continuous value (samples or a high-PPQ tick count)
internally, and the visible "grid"/snap setting is a display and editing
convenience layered on top, fully decoupled from storage precision — not a
resolution ceiling. It also lines up with how the eventual
[Tone.js](./libraries.md#tonejs--adopt-but-its-a-rewrite-not-just-an-addition)
rewrite represents time: `Tone.Transport` accepts plain seconds, raw ticks,
`"bars:beats:sixteenths"`, or notation strings like `"4n"` or the triplet
form `"8t"`, all resolving through a configurable `PPQ` (default 192) —
this app's continuous beat-floats convert cleanly to any of those without
a rethink. tonal.js has no bearing here at all: it models pitch space only
(scales, chords, intervals), not rhythm or duration.

---

## Event tracks

A **timeline event** is a point-in-time marker that changes a _context value_
from its beat onward, until superseded by the next event of the same type. This
is the same model as MIDI meta-events (tempo, time signature) and is what makes
scale/chord/arranger tracks a family rather than three unrelated features.

```typescript
type TimelineEvent<TPayload> = { id: string; beat: number } & TPayload;

type EventTrack<TPayload> = TimelineEvent<TPayload>[]; // kept sorted by beat
```

An intersection, not a nested `payload` property — every concrete event
type below (`ScaleEvent`, `ChordEvent`, `TempoEvent`, ...) already declares
`root`/`mode`, `bpm`, etc. as flat fields alongside `id`/`beat`, not wrapped
in a `payload` object. `TimelineEvent<{ root: number; mode: string }>` is
exactly the flattened shape `{ id, beat, root, mode }` — so
`type ScaleTrack = ScaleEvent[]` genuinely satisfies `EventTrack<ScaleEvent>`
as written, rather than only being described as one.

### Resolving "the active value at beat X"

```typescript
function activeEventAt<T>(track: EventTrack<T>, beat: number): TimelineEvent<T> | undefined {
  // last event with event.beat <= beat (binary search over the sorted array)
}
```

Every consumer (note grid highlighting, ruler rendering, export) asks the track
"what's active here?" rather than maintaining its own copy of the current value.

**Beats are unique per track.** Two events at the identical beat would make
"last event with `beat <= beat`" ambiguous — which one is "last" depends on
insertion order or search-implementation detail, not anything meaningful
about the document. Rather than defining a tie-break rule for
`activeEventAt` to apply at read time, the write side prevents the
ambiguity from existing at all: placing a new event at a beat that already
has one on that track **replaces** the existing event there, the same way
dragging a scale-marker to an occupied position would visually just move it,
not stack a second marker on top. This is specific to event tracks (a
context value like "the active scale" can only be one thing at a time at a
given beat) — it has no bearing on notes, where multiple simultaneous notes
at the same beat are normal and already covered by
[editing-model.md](./editing-model.md#overlap-policy-notes-may-overlap-freely)'s
overlap policy.

### Track types built on this abstraction

| Track          | Payload                      | Status                                                                                                     |
| -------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Tempo          | `{ bpm: number }`            | Formalises the existing single `tempo`                                                                     |
| Time signature | `{ numerator, denominator }` | Specified — see [tracks.md](./tracks.md#time-signature-track-specified); replaces the hardcoded 4-beat bar |
| Scale          | see [tracks.md](./tracks.md) | Specified                                                                                                  |
| Chord          | see [tracks.md](./tracks.md) | Placeholder                                                                                                |
| Labels         | see [tracks.md](./tracks.md) | Placeholder                                                                                                |
| Arranger       | _sections_, not point events | Placeholder — see below                                                                                    |

Notes themselves (`Note[]`) are **not** an event track — they're a flat
collection positioned on the timeline, not a "current value" concept.

---

## Sections (arranger) vs. events

Point events (tempo, time sig, scale, chord) answer "what's active here?".
Sections answer "what spans this range?" and additionally need **move** and
**duplicate** operations that carry their contents along:

```typescript
interface ArrangerSection {
  id: string;
  label: string;
  startBeat: number;
  endBeat: number; // exclusive
  color: string;
}
```

### Ripple semantics (open design question)

Moving or duplicating a section must decide what happens to:

1. Content strictly inside `[startBeat, endBeat)` — notes and events that
   belong to the section. These should move/copy with it, remapped by
   `delta = newStartBeat - startBeat`.
2. Everything **after** the section — does moving section B ripple every
   later section and its contents forward (Cubase/Pro Tools "insert time"
   style), or does it only affect B's own span, allowing overlaps?

This spec intentionally leaves #2 open — it's a real product decision (ripple
vs. free placement) that should be made when the arranger track is actually
scheduled, not guessed at now. Both are representable with the `EventTrack`
model above; only the _edit operation_ differs. In the meantime,
[tracks.md](./tracks.md#v1-default-annotation-only-no-content-ripple)
specifies a simpler v1 default (sections are annotation-only, #1 doesn't
apply yet either) so the arranger lane is useful before this question has to
be answered for real.

---

## Synced scroll

Because every track shares one beat coordinate system, all track lanes (note
grid, scale lane, chord lane, arranger lane) must share horizontal scroll
position and `pixelsPerBeat` zoom. See [tracks.md](./tracks.md) for the lane
component that consumes this.

---

## Data model additions

```typescript
interface TempoEvent {
  id: string;
  beat: number;
  bpm: number;
}

interface TimeSignatureEvent {
  id: string;
  beat: number;
  numerator: number;
  denominator: number;
}

type TempoTrack = TempoEvent[];
type TimeSignatureTrack = TimeSignatureEvent[];
```

`id` matches `ScaleEvent`/`ChordEvent`/`LabelEvent` ([tracks.md](./tracks.md))
— any UI that lets a user drag or delete one specific tempo/time-signature
marker needs a stable reference to it that survives the array being
resorted or another event being inserted before it; an array index doesn't
survive that, an `id` does.

**Convention, stated once for every current and future track type:**
concrete events (`TempoEvent`, `TimeSignatureEvent`, `ScaleEvent`,
`ChordEvent`, `LabelEvent`) are always **complete types** — `id`, `beat`,
and their own fields declared directly, not a separate payload type wrapped
in `TimelineEvent<Payload>`. `TimelineEvent<TPayload>`/`EventTrack<TPayload>`
above exist to describe the family's shared shape generically (what
`activeEventAt` operates on), not as a type every concrete event must
literally reference. `TempoTrack`/`TimeSignatureTrack` here match
`ScaleTrack`/`ChordTrack`/`LabelTrack` in [tracks.md](./tracks.md) — every
track type gets a named `XTrack = XEvent[]` alias, not just some of them.

`store.svelte.ts`'s single `tempo: number` becomes the payload of the first
`TempoEvent` at beat 0; a project with no further tempo events behaves exactly
as today.

---

## Future Work

- Bar/beat ruler rendering driven by the time-signature track instead of a
  fixed 4-beat assumption
- Tempo automation (more than one tempo event) and its effect on the audio
  scheduler's lookahead math
- Resolve the ripple-vs-free-placement question above before implementing the
  arranger track
