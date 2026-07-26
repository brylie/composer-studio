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

| Spec placeholder | tonal.js equivalent |
| --- | --- |
| `pitchClassesFor(root, mode)` in [tracks.md](./tracks.md#context-aware-highlighting) | `Scale.get(`${root} ${mode}`).notes`, mapped to pitch classes |
| `ScaleEvent.mode` "TBD" vocabulary | tonal's scale name strings (`'major'`, `'dorian'`, `'harmonic minor'`, ...) — a large, standard, already-named set |
| `pitchClassesForChord(chord)` in [tracks.md](./tracks.md#chordevent-carries-a-pitch-class-set-not-just-a-label) | `Chord.get(`${root}${quality}`).notes` |
| `ChordEvent.quality` "TBD" vocabulary | tonal's chord symbol vocabulary (`'maj7'`, `'sus4'`, `'m7b5'`, ...) |
| `mode-shift` / `reharmonization` target selection in [transformations.md](./transformations.md) | `Scale.get`/`Key.majorKey`/`Key.minorKey` for scale-degree and relative-key relationships |
| Voice-leading math for `generate-chords` and `voice-leading-adapt` | `@tonaljs/voice-leading`'s voicing helpers as a starting point — likely needs the app's own smoothing logic layered on top, but not built from zero |

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

| Current `audio.ts` | Tone.js equivalent |
| --- | --- |
| Manual `setInterval` lookahead scheduler | `Tone.Transport` (sample-accurate scheduling, drift-corrected) |
| Manual loop-iteration math | `Tone.Transport.loop` / `loopStart` / `loopEnd` — maps directly onto this app's `loopStart`/`loopEnd`/`loopEnabled` fields from [piano-roll.md](./piano-roll.md#ruler) |
| Hand-built oscillator graph per note | `Tone.PolySynth` (voice allocation included — relevant once `generate-chords` produces simultaneous notes) |
| Manual ADSR via `GainNode.gain` automation | Built into `Tone.Synth`'s envelope |
| "Effects ▾ Reserved (reverb / delay — future work)" in [piano-roll.md](./piano-roll.md#synth-panel--responsive-sound-drawer) | `Tone.Reverb`, `Tone.FeedbackDelay`, `Tone.Chorus`, `Tone.Distortion`, etc. — this future-work placeholder exists mainly *because* building effects on raw Web Audio nodes is exactly the tedious work Tone.js exists to remove |
| Single global `tempo` | `Tone.Transport.bpm`, a signal — can schedule changes at specific transport times, which lines up with the multi-`TempoEvent` track in [timeline.md](./timeline.md) |

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

### Sampled piano as the primary instrument

Per [README.md](./README.md#scope), realistic piano sound is the priority
over the current oscillator-only synth — appropriate for a piano-composition
tool where you're listening to judge the actual music, not a synth patch.
`Tone.Sampler` maps a set of recorded piano notes across the keyboard,
pitch-shifting between sample points:

```typescript
const piano = new Tone.Sampler({
	urls: { /* a handful of sampled notes across the range, e.g. every major third */ },
	baseUrl: '/samples/piano/',
	onload: () => { /* ready — see loading below */ }
});
```

- **Sample source**: a freely-licensed multi-velocity piano set (e.g. the
  Salamander Grand Piano samples commonly bundled with Tone.js examples,
  CC-BY) rather than recording anything in-house.
- **Loading**: sample files are tens of MB uncompressed across a full velocity
  range — too much to block on before the app is usable. Load asynchronously
  after first interaction (matches the existing lazy `AudioContext` creation
  in `audio.ts`), play back through the existing synth waveform as a fallback
  until the sampler reports `onload`, and surface a lightweight loading
  indicator in the Sound drawer rather than silently doing nothing on early
  keypresses.
- **Hosting**: bundled as static assets (`src/lib/assets` / `static/`) vs.
  fetched from a CDN is a deployment decision, not a spec decision — either
  works with `Tone.Sampler`'s `baseUrl`; revisit once a deployment target is
  chosen.
- **Instrument selector, not a replacement**: the Sound drawer's existing
  Waveform dropdown becomes an **Instrument** selector — "Piano" (sampled,
  default) alongside the existing Sine/Square/Sawtooth/Triangle oscillator
  options, per [piano-roll.md](./piano-roll.md#synth-panel--responsive-sound-drawer).
  Envelope/Filter controls remain meaningful for the oscillator voices; for
  the sampled piano they're reduced-scope (release time still applies, attack
  and filter largely don't since the sample carries its own timbre) rather
  than removed outright.
- **Per-layer, once layers exist**: this instrument selector is described
  above as document-wide because that's the current (and v1) scope. Once
  [layers.md](./layers.md) lands, each layer gets its own instrument
  settings and its own `Tone.Sampler`/`Tone.PolySynth` instance — the Sound
  drawer then edits whichever layer is currently active, not a single
  global instrument. No change to the underlying Tone.js approach, just to
  how many instances of it exist.

---

## Package additions

Both would be added to `package.json` dependencies (not devDependencies —
both run in the browser at runtime, unlike the project's existing
`devDependencies`-only tooling).
