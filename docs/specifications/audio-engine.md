# Audio Engine and Export Specification

## Overview

Decomposed out of [piano-roll.md](./piano-roll.md), which was accumulating
UI-feature docs, audio-internals docs, and export-format docs in one file.
This covers the two things that turn the `Note[]` document into sound or a
file: the real-time playback engine (`audio.ts`) and MIDI export
(`midi-export.ts`). Project-file export/import (the shareable save format)
is a separate concern, specified in [persistence.md](./persistence.md) —
this document is about rendering to _audio_ or to the _MIDI standard_, not
about saving/loading this app's own document.

> This documents the Tone.js-based implementation adopted in Phase 5, per
> [libraries.md](./libraries.md#tonejs--adopt-but-its-a-rewrite-not-just-an-addition).
> It replaced the original hand-rolled `AudioContext`/`OscillatorNode`
> scheduler wholesale, not additively.

---

## Audio engine (`audio.ts`)

### Instrument

One document-wide `Tone.PolySynth(Tone.Synth)` ("piano"), routed through a
single shared post-synth `Tone.Filter` — not a per-voice filter, matching the
Sound drawer's one Cutoff/Resonance pair — per
[libraries.md](./libraries.md#mvp-default-instrument-tonepolysynth-over-tonesynth).
Both are created lazily on first use, since Tone can't touch the audio
context before a user gesture. `SynthSettings` (waveform, envelope, volume,
filter) are re-applied to the shared instrument on every note trigger and
scheduler tick — oscillator `type` and `envelope` via `PolySynth.set()`,
`volume` converted from the store's 0–100 linear scale to decibels via
`Tone.gainToDb`, and the filter's `enabled` flag toggled by reconnecting the
synth directly to the destination versus through the filter (only on actual
state change, to avoid needless graph churn every tick).

### Playback scheduler

`Tone.Transport` is the master clock — a drift-corrected, audio-context-clock
driven scheduler, replacing the old main-thread `setInterval`. A repeating
event (`Transport.scheduleRepeat`, still a 25 ms interval and 100 ms lookahead
window, matching the original scan cadence) scans `getNotes()` fresh on every
tick — so notes added while the transport is running are picked up without
needing to stop/restart playback — and calls `PolySynth.triggerAttackRelease`
for anything entering the lookahead window, keyed by `noteId:loopPass` to
prevent double-scheduling. `Tone.Transport.bpm` is kept in sync with
`getTempo()` every tick, so tempo changes during playback don't cause a
position discontinuity the way recomputing beats-from-elapsed-wall-time by
hand would.

A `requestAnimationFrame` loop reads `Transport.ticks` (converted to beats
via `Transport.PPQ`) to drive `onTick`/the playhead, same cadence as before.

### Loop handling

`Transport.loop`/`loopStart`/`loopEnd` replace the old manual
`minLoop`/`maxLoop` iteration math — the transport wraps its own tick
position at `loopEnd` and emits a `"loop"` event, which `audio.ts` uses only
to bump a `_loopPass` counter for the dedup key above. `loopStart` is always
`0` and `loopEnd` tracks `totalBeats` today, recomputed every tick since
`totalBeats` can grow while playing (a note dragged past the current end).
Adjustable in/out points are still the planned Ruler feature
([piano-roll.md](./piano-roll.md#ruler)) — `loopStart`/`loopEnd` don't exist
on `EditorState`/`store.svelte.ts` yet, so there's nothing for the scheduler
to read even once Transport-based looping already supports it structurally.

### Frequency mapping

$$f = 440 \times 2^{(\text{midiNote} - 69) \,/\, 12}$$

Still done by hand (`midiToFreq`) rather than via Tone's note-name parsing,
since `Note.midiNote` is the app's native representation and
`PolySynth.triggerAttackRelease` accepts a raw frequency number directly —
no need to round-trip through Tone's `'C4'`-style note names.

### Audition (key click)

Triggers a 500 ms note at the clicked pitch, using current synth settings,
via the same shared `PolySynth`.

### Stopping playback

`Transport.stop()` halts the scheduler and playhead. `PolySynth.releaseAll()`
alone isn't enough for immediate silence — it still runs the configured
release envelope (up to 4s, per the Sound drawer's Release slider), and it
can't un-sound attacks already scheduled inside the 100ms lookahead window.
Instead, `stopPlayback()` disposes the shared `PolySynth` outright for a hard
cutoff, and clears the cached "last applied settings"/filter-routing state so
`getPiano()`/`applySettings()` lazily recreate and fully reconfigure a fresh
instrument (oscillator, envelope, volume, filter routing) the next time a
note is triggered or auditioned — the original hand-rolled scheduler had no
equivalent, since once `osc.start(t)`/`osc.stop(t)` were scheduled on the raw
`AudioContext` they couldn't be un-scheduled.

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
