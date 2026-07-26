# Audio Engine and Export Specification

## Overview

Decomposed out of [piano-roll.md](./piano-roll.md), which was accumulating
UI-feature docs, audio-internals docs, and export-format docs in one file.
This covers the two things that turn the `Note[]` document into sound or a
file: the real-time playback engine (`audio.ts`) and MIDI export
(`midi-export.ts`). Project-file export/import (the shareable save format)
is a separate concern, specified in [persistence.md](./persistence.md) —
this document is about rendering to *audio* or to the *MIDI standard*, not
about saving/loading this app's own document.

> This documents the current hand-rolled implementation. See
> [libraries.md](./libraries.md#tonejs--adopt-but-its-a-rewrite-not-just-an-addition)
> for the planned Tone.js migration — a rewrite of everything below, not an
> addition to it — and the open sequencing question of when to do it.

---

## Audio engine (`audio.ts`)

### AudioContext

One shared `AudioContext`, created lazily on first interaction (autoplay
policies require a user gesture before audio can start).

### Playback scheduler

- `setInterval` at **25 ms** intervals.
- On each tick, schedules all notes within the next **100 ms** lookahead
  window.
- Each note: `OscillatorNode → (optional BiquadFilterNode) → GainNode → destination`.
- Applies **ADSR envelope** via `GainNode.gain` `AudioParam` automation.
- Tracks scheduled notes by `noteId:loopIteration` key to prevent
  double-scheduling.
- A `requestAnimationFrame` loop updates `currentBeat` for smooth playhead
  animation.

### Loop handling

When `loopEnabled` is `true`, the scheduler calculates the loop iteration for
each note and schedules it accordingly; the playhead wraps at `totalBeats`
today, with no adjustable in/out points. `loopStart`/`loopEnd` are a planned
Ruler feature ([piano-roll.md](./piano-roll.md#ruler)) — they don't exist on
`EditorState`/`store.svelte.ts` yet, so there's nothing for the scheduler to
read even once it's updated; both the data fields and the scheduler change
land together as one piece of future work, not two.

### Frequency mapping

$$f = 440 \times 2^{(\text{midiNote} - 69) \,/\, 12}$$

### Audition (key click)

Triggers a 500 ms note at the clicked pitch, using current synth settings.

---

## MIDI export (`midi-export.ts`)

Generates a **MIDI type-0** file entirely in-browser:

- **Resolution**: 480 ticks per quarter note.
- **Tempo event**: derived from current BPM.
- **Note On / Note Off** pairs sorted by absolute tick.
- **Channel**: 0.
- Delivered as a `Blob` download (`track.mid`).

This is a **one-way, lossy render** — scale/chord/arranger events and synth
settings don't survive it. That's fine for its purpose (opening the piece in
other software); it is not the save/share mechanism between you and your
friend, which is [persistence.md](./persistence.md)'s `export-project`/
`import-project` instead.

### MIDI import: not planned

Only export exists, and that's by design, not an oversight. Composer Studio
is a compositional tool, not a general-purpose DAW or practice app — see
[README.md](./README.md#explicit-non-goals-for-now). Starting a variation
from a melody that didn't originate in this app is a real workflow, but it's
not the priority workflow, and MIDI import (parsing arbitrary type-0/1 files,
reconciling foreign tempo/time-signature data with this app's own timeline)
is real work with no current motivating use case. Revisit if that changes.
