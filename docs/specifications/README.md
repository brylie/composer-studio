# Specifications

Design documents for Composer Studio, written ahead of implementation. Read in
roughly this order — each depends on the ones above it. For implementation
sequencing (what to build first and why), see [roadmap.md](./roadmap.md).

| Document                                     | Scope                                                                                                                                                                         |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [architecture.md](./architecture.md)         | Where code lives and what's allowed to depend on what — the domain/application/infrastructure/UI layering every other spec's code follows                                     |
| [piano-roll.md](./piano-roll.md)             | The existing note-editing surface: components, data model, UI features                                                                                                        |
| [editing-model.md](./editing-model.md)       | The note-mutation contract (clamping, overlap policy, precise entry, duplicate-in-place) every gesture and transform relies on                                                |
| [timeline.md](./timeline.md)                 | The shared beat/bar coordinate system and generic event-track abstraction everything else builds on                                                                           |
| [selection.md](./selection.md)               | Note selection: click/ctrl/shift/marquee, mobile draw-vs-select mode, the `SelectionContext` transformations read                                                             |
| [command-history.md](./command-history.md)   | Undo/redo architecture for destructive edits, generalized beyond notes                                                                                                        |
| [transformations.md](./transformations.md)   | The declarative command registry, plus the initial transform/generate/export catalog                                                                                          |
| [ribbon.md](./ribbon.md)                     | Ribbon UI/UX: data structure, responsive behavior, keyboard shortcuts                                                                                                         |
| [overlay-shells.md](./overlay-shells.md)     | The shared bottom-sheet/side-drawer pattern used by the parameter drawer, Sound drawer, and note inspector                                                                    |
| [tracks.md](./tracks.md)                     | Time signature and scale tracks (specified), chord and arranger tracks (placeholders)                                                                                         |
| [layers.md](./layers.md)                     | Multiple instruments as Photoshop-style layers over one shared piano roll, not separate tracks — later-stage, but resolves how orchestration will actually work               |
| [command-palette.md](./command-palette.md)   | Future milestone — searchable command palette over the same registry                                                                                                          |
| [accessibility.md](./accessibility.md)       | Living cross-cutting standard referenced by all of the above                                                                                                                  |
| [state-ownership.md](./state-ownership.md)   | Application state lives behind a root-provided Svelte context, not a bare module singleton — supports nested overrides for multi-instance and test isolation                  |
| [libraries.md](./libraries.md)               | tonal.js (music theory) and Tone.js (audio) — what they replace, the adoption cost of each, and why sampled instruments are deferred past MVP in favor of a `PolySynth` piano |
| [audio-engine.md](./audio-engine.md)         | The current hand-rolled playback scheduler and MIDI export                                                                                                                    |
| [design-tokens.md](./design-tokens.md)       | Color/spacing tokens via Tailwind v4's `@theme`, and what other specs reference by name (scale highlight, loop band, section colors)                                          |
| [persistence.md](./persistence.md)           | Project save/load (autosave + IndexedDB) and the shareable project-file format                                                                                                |
| [testing-strategy.md](./testing-strategy.md) | Coverage targets and scope for Vitest, Storybook, and Playwright — deferred until implementation begins                                                                       |
| [performance.md](./performance.md)           | Known future risk areas (grid virtualization, snapshot cost) — deferred until profiling says otherwise                                                                        |
| [roadmap.md](./roadmap.md)                   | Implementation sequencing: dependency map, phases, and where work can be parallelized                                                                                         |

## Scope

**v1 targets a single piano-roll timeline** — one `Note[]` collection, one
undo history, one ribbon instance. Melody and generated accompaniment (e.g.
voice-led chords) coexist as notes on that same timeline, distinguished only
by pitch register and selection, not yet by separate instruments — this is
deliberately simple and is what makes piano composition a good starting
target. Multi-instrument orchestration is real future work, not a v1
concern, but its shape is already resolved: **layers, not separate tracks
or editor instances** — one shared pitch/time space, instruments
distinguished by which layer a note belongs to (see
[layers.md](./layers.md)). This also settles what
[state-ownership.md](./state-ownership.md)'s multi-instance support is
actually for: genuinely separate documents and test isolation, not
per-instrument editing, which stays on one document/selection/undo-history
throughout.

### Explicit non-goals (for now)

Settled via direct discussion, recorded here so they aren't re-litigated per
spec:

- **No backend, no accounts, no real-time collaboration.** Local-first;
  sharing happens by handing someone a project file (see
  [persistence.md](./persistence.md)), not by two people editing the same
  document at once.
- **No staff notation** — view or export. The piano roll is the only
  representation; MusicXML/engraving is not planned.
- **MVP instrument is a `Tone.PolySynth` piano preset, not a sampled one.**
  Realistic sampled piano sound is a reasonable later addition, but not
  before the ribbon/transform/generate workflow this spec set centers on is
  proven out — sample licensing, hosting, and load-failure handling are real
  scope that the priority use case (correct notes, not piano timbre) doesn't
  need yet (see [libraries.md](./libraries.md#mvp-default-instrument-tonepolysynth-over-tonesynth)).
- **This is a compositional tool, not a practice app.** No MIDI import (see
  [audio-engine.md](./audio-engine.md#midi-import-not-planned)), no
  metronome, count-in, or slow-practice-tempo features. Nothing here rules
  those out forever — they're just not this project's problem to solve.

## Status

All documents above are design specs, not yet implemented, except
`piano-roll.md` which documents the current codebase. Open questions are
called out explicitly within each document rather than resolved by guessing.
