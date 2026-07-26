# Third-Party Libraries: tonal.js and Tone.js

## Overview

Two library adoptions worth recording centrally since they're referenced from
several other specs: [tonal.js](https://tonaljs.github.io/tonal/docs) for
music-theory computation, and [Tone.js](https://tonejs.github.io/) for audio.
They have very different adoption costs, addressed separately below.

---

## tonal.js — adopt now

Several specs in this directory currently say "vocabulary TBD" or hand-wave a
pitch-class computation that tonal.js already solves, well-tested, for free:

| Spec placeholder                                                                                                | tonal.js equivalent                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pitchClassesFor(root, mode)` in [tracks.md](./tracks.md#context-aware-highlighting)                            | `Scale.get(`${root} ${mode}`).notes`, mapped to pitch classes                                                                                       |
| `ScaleEvent.mode` "TBD" vocabulary                                                                              | tonal's scale name strings (`'major'`, `'dorian'`, `'harmonic minor'`, ...) — a large, standard, already-named set                                  |
| `pitchClassesForChord(chord)` in [tracks.md](./tracks.md#chordevent-carries-a-pitch-class-set-not-just-a-label) | `Chord.get(`${root}${quality}`).notes`                                                                                                              |
| `ChordEvent.quality` "TBD" vocabulary                                                                           | tonal's chord symbol vocabulary (`'maj7'`, `'sus4'`, `'m7b5'`, ...)                                                                                 |
| `mode-shift` / `reharmonization` target selection in [transformations.md](./transformations.md)                 | `Scale.get`/`Key.majorKey`/`Key.minorKey` for scale-degree and relative-key relationships                                                           |
| Voice-leading math for `generate-chords` and `voice-leading-adapt`                                              | `@tonaljs/voice-leading`'s voicing helpers as a starting point — likely needs the app's own smoothing logic layered on top, but not built from zero |

This is a low-risk adoption: it's mostly filling in logic these specs already
call for but leave as "TBD" or a hand-rolled interval table, not replacing
anything that currently works. It doesn't touch `audio.ts`, `midi-export.ts`,
or the existing note-grid interaction code at all.

### Recommendation: wrap it, don't spray it

Rather than calling `tonal` directly from components and transform commands
throughout the codebase, put a thin adapter module at
`src/lib/music-theory/` that exposes exactly the queries this app needs
(`pitchClassesForScale(root, mode)`, `pitchClassesForChord(root, quality)`,
relative-key lookups, ...) and translates between tonal's note-name strings
(`'C4'`, `'Db3'`) and this app's MIDI-number-based `Note` model internally.
Two reasons: it keeps tonal's specific API/data shapes from leaking into
every command's `run()`, and if a gap is ever found (e.g. voice-leading needs
more than `@tonaljs/voice-leading` offers), custom logic slots into the same
adapter without an API change at every call site.

### Package footprint

Tonal is published as small, independent, tree-shakeable packages
(`@tonaljs/scale`, `@tonaljs/chord`, `@tonaljs/note`, ...) rather than one
monolith — pull in only the pieces the adapter module above actually needs.

---

## Tone.js — adopt, but it's a rewrite, not just an addition

[`audio.ts`](./audio-engine.md) today hand-rolls exactly what `Tone.Transport` is designed for: a
`setInterval`-based 25ms scheduler with a 100ms lookahead window, manual
`noteId:loopIteration` de-duplication, and hand-built
`OscillatorNode → BiquadFilterNode → GainNode` graphs with manual ADSR
automation. Tone.js would replace that machinery, not sit alongside it:

| Current `audio.ts`                                                                                                           | Tone.js equivalent                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manual `setInterval` lookahead scheduler                                                                                     | `Tone.Transport` (sample-accurate scheduling, drift-corrected)                                                                                                                                                                  |
| Manual loop-iteration math                                                                                                   | `Tone.Transport.loop` / `loopStart` / `loopEnd` — maps directly onto this app's `loopStart`/`loopEnd`/`loopEnabled` fields from [piano-roll.md](./piano-roll.md#ruler)                                                          |
| Hand-built oscillator graph per note                                                                                         | `Tone.PolySynth` (voice allocation included — relevant once `generate-chords` produces simultaneous notes)                                                                                                                      |
| Manual ADSR via `GainNode.gain` automation                                                                                   | Built into `Tone.Synth`'s envelope                                                                                                                                                                                              |
| "Effects ▾ Reserved (reverb / delay — future work)" in [piano-roll.md](./piano-roll.md#synth-panel--responsive-sound-drawer) | `Tone.Reverb`, `Tone.FeedbackDelay`, `Tone.Chorus`, `Tone.Distortion`, etc. — this future-work placeholder exists mainly _because_ building effects on raw Web Audio nodes is exactly the tedious work Tone.js exists to remove |
| Single global `tempo`                                                                                                        | `Tone.Transport.bpm`, a signal — can schedule changes at specific transport times, which lines up with the multi-`TempoEvent` track in [timeline.md](./timeline.md)                                                             |

The recommendation is still **yes** — the alternative is hand-maintaining
scheduler edge cases (drift, lookahead sizing) and building a reverb/delay
DSP graph by hand, both of which Tone.js has already solved. But unlike
tonal.js, this isn't additive: it's a rewrite of `audio.ts`, which currently
works. Sequencing options:

1. **Do it now**, before building the ribbon/transform work, so every new
   feature is built against the eventual audio engine instead of the
   soon-to-be-replaced one.
2. **Defer it** until effects or chord polyphony actually become the
   priority — none of the ribbon, selection, command-history, or
   transformation specs in this directory depend on which audio engine is
   underneath; they only touch the `Note[]` data model. Rewrite `audio.ts`
   as its own scoped milestone when that becomes the bottleneck, rather than
   doing two audio-engine changes (once now, possibly again later).

No default is asserted here — worth a quick decision before implementation
starts, since it changes what the first few PRs touch.

### MVP default instrument: `Tone.PolySynth` over `Tone.Synth`

Revised from an earlier direction: realistic sampled piano sound was briefly
the stated priority (see [Sampled instruments — deferred past MVP](#sampled-instruments--deferred-past-mvp)
below for why that's no longer true right now). Introducing sample playback
this early would also introduce sample licensing/attribution, hosting, and
async-loading-failure concerns into the MVP timeline for a feature that
doesn't block proving out the ribbon/transform/generate workflow this whole
spec set is centered on — the actual priority use case (voice-led chord
generation + melody variation on one timeline, per
[README.md](./README.md#scope)) doesn't need a convincing piano _timbre_, it
needs correct _notes_. A synth-based piano is enough to judge that, and adds
zero new external dependencies beyond Tone.js itself:

```typescript
const filter = new Tone.Filter({ frequency: 4000, Q: 1, type: 'lowpass' });

const piano = new Tone.PolySynth(Tone.Synth, {
  oscillator: { type: 'triangle' }, // closer to piano harmonic content than a sine
  envelope: {
    attack: 0.005,
    decay: 0.1,
    sustain: 0.3,
    release: 1,
  },
}).connect(filter);

filter.toDestination();

piano.triggerAttackRelease(['C4', 'E4', 'G4'], '8n'); // chords: pass an array of notes
piano.triggerAttackRelease('C5', '4n');
```

- **Polyphony is the reason this is a `PolySynth`, not a bare `Synth`**:
  `Tone.PolySynth` manages voice allocation internally, so
  `generate-chords` producing several simultaneous notes (or any ordinary
  chord under the fingers) just works — `triggerAttackRelease` accepts an
  array of notes directly. This was already the plan per the table above;
  nothing about deferring sampling changes it.
- **The filter is post-synth (one shared `Tone.Filter`), not per-voice.**
  `Tone.Synth` — unlike `Tone.MonoSynth` — has no built-in filter or filter
  envelope, so it has to be wired explicitly rather than assumed. A single
  filter connected after the whole `PolySynth` matches what the Sound
  drawer's Filter section already implies: one shared Cutoff/Resonance
  pair, not a per-note filter envelope. `frequency` maps to Cutoff (Hz),
  `Q` to Resonance, and the drawer's Enable toggle simply toggles the
  `piano → filter → destination` chain versus `piano → destination`
  directly. A genuinely per-voice filter (independent filter envelope per
  note, closer to a real piano's attack-dependent brightness) would mean
  swapping the voice type to `Tone.MonoSynth`, which does have one built
  in — a reasonable future refinement, not needed for the MVP's single
  shared Cutoff/Resonance control surface.
- **Instrument selector**: the Sound drawer's Waveform dropdown becomes an
  **Instrument** selector, but for MVP its only entry is this "Piano"
  `PolySynth` preset alongside the existing Sine/Square/Sawtooth/Triangle
  raw-oscillator options, per
  [piano-roll.md](./piano-roll.md#synth-panel--responsive-sound-drawer) —
  no "sampled" entry yet. Envelope/Filter controls apply to it the same way
  they already apply to the other oscillator-based options, via the shared
  post-synth filter above; there's no reduced-scope carve-out to design
  since nothing here has its own hardcoded timbre to protect.
- **Per-layer, once layers exist**: this instrument selector is described
  above as document-wide because that's the current (and v1) scope. Once
  [layers.md](./layers.md) lands, each layer gets its own instrument
  settings and its own `Tone.PolySynth` instance — the Sound drawer then
  edits whichever layer is currently active, not a single global
  instrument. No change to the underlying Tone.js approach, just to how
  many instances of it exist.

### Sampled instruments — deferred past MVP

Real, freely-licensed multi-velocity piano samples (e.g. the Salamander
Grand Piano set commonly bundled with Tone.js examples) via `Tone.Sampler`
remain a reasonable **later** addition once the ribbon/transform/generate
workflow is proven out — "more instruments, including sampled instruments,
once the basic UX is fully realized." Deferring it avoids taking on, before
that UX exists: sample licensing/attribution tracking, hosting (bundled vs.
CDN) as a deployment decision, and asynchronous load-success/load-failure
handling (a lightweight loading indicator, a permanent synth fallback if
loading fails, and a manual retry affordance, since a multi-MB download
failing isn't a transient error worth silently retrying). None of that
design work is wasted by waiting — `Tone.Sampler` and `Tone.PolySynth`
share the same `triggerAttackRelease` interface, so adding "Piano (sampled)"
as a second Instrument-selector entry later doesn't require touching
anything about how notes get triggered, only which instrument backs the
selector's "Piano" option.

---

## Package additions

Both would be added to `package.json` dependencies (not devDependencies —
both run in the browser at runtime, unlike the project's existing
`devDependencies`-only tooling).
