# Specifications

Design documents for Composer Studio, written ahead of implementation. Read in
roughly this order — each depends on the ones above it. For implementation
sequencing (what to build first and why), see [roadmap.md](./roadmap.md).

| Document | Scope |
| --- | --- |
| [architecture.md](./architecture.md) | Where code lives and what's allowed to depend on what — the domain/application/infrastructure/UI layering every other spec's code follows |
| [piano-roll.md](./piano-roll.md) | The existing note-editing surface: components, data model, UI features |
| [editing-model.md](./editing-model.md) | The note-mutation contract (clamping, overlap policy, precise entry, duplicate-in-place) every gesture and transform relies on |
| [timeline.md](./timeline.md) | The shared beat/bar coordinate system and generic event-track abstraction everything else builds on |
| [selection.md](./selection.md) | Note selection: click/ctrl/shift/marquee, mobile draw-vs-select mode, the `SelectionContext` transformations read |
| [command-history.md](./command-history.md) | Undo/redo architecture for destructive edits, generalized beyond notes |
| [transformations.md](./transformations.md) | The declarative command registry, plus the initial transform/generate/export catalog |
| [ribbon.md](./ribbon.md) | Ribbon UI/UX: data structure, responsive behavior, keyboard shortcuts |
| [overlay-shells.md](./overlay-shells.md) | The shared bottom-sheet/side-drawer pattern used by the parameter drawer, Sound drawer, and note inspector |
| [tracks.md](./tracks.md) | Scale track (specified), chord and arranger tracks (placeholders) |
| [command-palette.md](./command-palette.md) | Future milestone — searchable command palette over the same registry |
| [accessibility.md](./accessibility.md) | Living cross-cutting standard referenced by all of the above |
| [state-ownership.md](./state-ownership.md) | Singleton-module vs. Svelte-context trade-off, deferred until it's actually forced |
| [libraries.md](./libraries.md) | tonal.js (music theory) and Tone.js (audio, incl. sampled piano) — what they replace, and the adoption cost of each |
| [audio-engine.md](./audio-engine.md) | The current hand-rolled playback scheduler and MIDI export |
| [design-tokens.md](./design-tokens.md) | Color/spacing tokens via Tailwind v4's `@theme`, and what other specs reference by name (scale highlight, loop band, section colors) |
| [persistence.md](./persistence.md) | Project save/load (autosave + IndexedDB) and the shareable project-file format |
| [testing-strategy.md](./testing-strategy.md) | Coverage targets and scope for Vitest, Storybook, and Playwright — deferred until implementation begins |
| [performance.md](./performance.md) | Known future risk areas (grid virtualization, snapshot cost) — deferred until profiling says otherwise |
| [roadmap.md](./roadmap.md) | Implementation sequencing: dependency map, phases, and where work can be parallelized |

## Scope

**v1 targets a single piano-roll timeline** — one `Note[]` collection, one
undo history, one ribbon instance. Melody and generated accompaniment (e.g.
voice-led chords) coexist as notes on that same timeline, distinguished only
by pitch register and selection, not by separate tracks or instruments — this
is deliberately simple and is what makes piano composition a good starting
target. Orchestration (independent tracks per instrument, multiple
simultaneous editors) is real future work, not a v1 concern, and is called out
wherever it would otherwise force a premature decision (see
[state-ownership.md](./state-ownership.md)).

### Explicit non-goals (for now)

Settled via direct discussion, recorded here so they aren't re-litigated per
spec:

- **No backend, no accounts, no real-time collaboration.** Local-first;
  sharing happens by handing someone a project file (see
  [persistence.md](./persistence.md)), not by two people editing the same
  document at once.
- **No staff notation** — view or export. The piano roll is the only
  representation; MusicXML/engraving is not planned.
- **Sampled piano is the primary instrument**, not synth-only — realism
  matters here because the point is judging the actual music, not exploring
  synth timbres (see [libraries.md](./libraries.md#sampled-piano-as-the-primary-instrument)).
- **This is a compositional tool, not a practice app.** No MIDI import (see
  [audio-engine.md](./audio-engine.md#midi-import-not-planned)), no
  metronome, count-in, or slow-practice-tempo features. Nothing here rules
  those out forever — they're just not this project's problem to solve.

## Status

All documents above are design specs, not yet implemented, except
`piano-roll.md` which documents the current codebase. Open questions are
called out explicitly within each document rather than resolved by guessing.
