# Roadmap

## Overview

Sequencing for the specs in this directory, based on what actually blocks
what — not just a priority-ordered wishlist. The guiding constraint: your
named priority use case ("generate chords with voice leading in a particular
octave while creating melodies and variations on selected notes, on the same
timeline") should be reachable as early as possible, and everything else
sequenced around what that actually requires versus what it doesn't.

---

## Dependency map

| Spec                                                                                                                     | Importance                                                                                   | Complexity                                                                                           | Hard dependency on                                                               | Unlocks                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [architecture.md](./architecture.md)                                                                                     | High — a naming/layering convention, cheap now, costly to retrofit                           | Trivial (a convention, not code)                                                                     | Nothing                                                                          | Nothing blocks on it, but everything is easier to place correctly if it exists first                                   |
| [design-tokens.md](./design-tokens.md)                                                                                   | Low-Medium — avoids every component inventing its own colors                                 | Trivial (an `@theme` block, not new tooling)                                                         | Nothing                                                                          | ribbon.md, tracks.md, piano-roll.md all reference specific tokens by name (scale highlight, loop band, section colors) |
| [selection.md](./selection.md)                                                                                           | High — everything acts on a selection                                                        | Low (extends existing `store.svelte.ts`)                                                             | Nothing new                                                                      | transformations.md                                                                                                     |
| [command-history.md](./command-history.md)                                                                               | High — destructive edits need undo to be safe                                                | Low (fixes/generalizes existing code)                                                                | Nothing new                                                                      | transformations.md                                                                                                     |
| [editing-model.md](./editing-model.md)                                                                                   | High — every mutation, gesture or command, relies on this contract                           | Low (mostly formalizing existing `updateNote` behavior; the note inspector is the one new component) | Nothing new                                                                      | transformations.md (clamping), persistence.md (valid data to save)                                                     |
| [state-ownership.md](./state-ownership.md)                                                                               | Medium — cheap now, a real migration if left until Application state modules multiply        | Low (a root context provider + getters, done once)                                                   | Nothing new                                                                      | Application state modules built in Phase 1 onward adopt the pattern from the start instead of retrofitting it          |
| [libraries.md](./libraries.md) — tonal.js                                                                                | High — resolves real music-theory logic                                                      | Low (additive, no rewrite)                                                                           | Nothing new                                                                      | transformations.md (mode-shift, reharmonization, generate-chords), tracks.md                                           |
| [transformations.md](./transformations.md)                                                                               | High — this is the product                                                                   | Medium                                                                                               | selection.md, command-history.md, tonal.js                                       | ribbon.md, command-palette.md                                                                                          |
| [ribbon.md](./ribbon.md)                                                                                                 | High — how any of this gets used                                                             | Medium (mostly responsive UI work)                                                                   | transformations.md's `CommandDescriptor` _shape_ (not every command implemented) | command-palette.md                                                                                                     |
| [persistence.md](./persistence.md)                                                                                       | High — data loss risk once real use starts                                                   | Medium                                                                                               | Just the current document shape, whatever it is                                  | Nothing else blocks on it                                                                                              |
| [libraries.md](./libraries.md) — Tone.js                                                                                 | Medium — audio quality, not core logic                                                       | Medium-High (rewrites working `audio.ts`)                                                            | Nothing new                                                                      | Effects; sampled instruments as a later addition, not part of this phase                                               |
| [timeline.md](./timeline.md) — event-track infra                                                                         | Medium                                                                                       | Medium                                                                                               | Nothing new                                                                      | tracks.md (scale/chord/labels)                                                                                         |
| [tracks.md](./tracks.md) — scale track                                                                                   | Medium — nice, not required for the priority use case                                        | Medium-High (the per-segment highlighting is the trickiest UI spec'd so far)                         | timeline.md                                                                      | Scale-aware transforms (mode-shift, reharmonization), `generate-chords` `source: 'chord-track'`                        |
| [tracks.md](./tracks.md) — chord track                                                                                   | Medium                                                                                       | Medium                                                                                               | scale track                                                                      | `generate-chords` upgrade path (see below)                                                                             |
| [tracks.md](./tracks.md) — labels track                                                                                  | Low                                                                                          | Low                                                                                                  | timeline.md                                                                      | Nothing blocks on it                                                                                                   |
| [command-palette.md](./command-palette.md)                                                                               | Low (already deferred)                                                                       | Low once the registry exists                                                                         | transformations.md                                                               | Nothing blocks on it                                                                                                   |
| [tracks.md](./tracks.md) — arranger track                                                                                | Low for v1 (annotation-only)                                                                 | Low for v1, high for content-carrying                                                                | timeline.md                                                                      | Nothing blocks on it yet                                                                                               |
| [layers.md](./layers.md)                                                                                                 | Low for v1 (explicitly later-stage), high once multi-instrument orchestration is prioritized | Medium (`Note.layerId`, per-layer instrument/audio instance, layer panel UI, persistence migration)  | editing-model.md (`Note` shape), selection.md (`activeLayers`)                   | Multi-instrument orchestration (choral/ensemble writing) without needing separate tracks or editor instances           |
| [testing-strategy.md](./testing-strategy.md), [accessibility.md](./accessibility.md), [performance.md](./performance.md) | Ongoing/reactive, not phase-gated — see below                                                | —                                                                                                    | —                                                                                | —                                                                                                                      |

The key finding: **`generate-chords` doesn't need the chord track.** It was
specified with `source: 'selection-derived'` precisely so voice-led
chord generation works from day one, off whatever melody notes are selected
— the chord track is an upgrade to _where the chord comes from_, not a
prerequisite. That's what makes the priority use case reachable in Phase 2
below, not Phase 6.

---

## Phases

### Phase 0 — Architecture convention

[architecture.md](./architecture.md).

Not implementation work — a naming/layering convention (Domain / Application
state / Infrastructure adapters / UI) to agree on _before_ Phase 2 creates
the first real Domain modules (the tonal.js adapter, the command registry).
Costs nothing to adopt from day one; costs a rename pass if adopted after
files already exist in the wrong place.

Good place to also land [design-tokens.md](./design-tokens.md)'s `@theme`
block — equally cheap, equally worth doing before components start
hardcoding one-off colors instead of referencing named tokens.

### Phase 1 — Selection + History + Editing-model foundation

[selection.md](./selection.md), [command-history.md](./command-history.md),
[editing-model.md](./editing-model.md), [state-ownership.md](./state-ownership.md).

Low complexity, no new external dependencies, and all four specs are hard
blockers for every transform command's `isApplicable()`/`run()` and undo
behavior. This is mechanical work extending `store.svelte.ts` — the
`SvelteSet` migration, the `'draw'`/`'select'` mode matrix, marquee
selection, clipboard, fixing the non-reactive undo-stack bug, and
formalizing the mutation invariants (clamping, overlap policy, the note
inspector). This is also the natural point to do the one-time
[state-ownership.md](./state-ownership.md) migration — moving `store` and
the new `CommandHistory`/selection state behind a root context provider
instead of bare module singletons — since these modules are being built out
for real here rather than just extended. Nothing here requires a design
decision that isn't already made.

### Phase 2 — tonal.js + the priority transform/generate commands

[libraries.md](./libraries.md) (tonal.js only), [transformations.md](./transformations.md).

Adopt tonal.js and the music-theory adapter module first — it's additive,
low-risk, and several commands need it immediately. Then build the
`CommandDescriptor` registry and implement, in order of value: `transpose`,
`retrograde`, `invert`, `augmentation`/`diminution`, `permutation`, `jitter`,
and **`generate-chords` with `source: 'selection-derived'`**. This phase
alone delivers the stated priority use case — voice-led chord generation
alongside melody variation on one timeline — without needing the ribbon,
timeline infrastructure, or scale/chord tracks. It can be exercised through a
minimal temporary UI (a few buttons) or developed test-first against Vitest
before Phase 3's real UI lands.

### Phase 3 — Ribbon UI + overlay shells

[ribbon.md](./ribbon.md), [overlay-shells.md](./overlay-shells.md).

Surfaces Phase 2's commands properly: Top Bar, Quick Access Bar, tabbed
ribbon, and the shared bottom-sheet/side-drawer shell the parameter drawer
needs (and which the Sound drawer and note inspector will also reuse once
their own phases land). Medium complexity, mostly responsive-layout work,
not deeply novel. **Only depends on the `CommandDescriptor` shape existing,
not on every command being implemented** — see Parallelization below. Ribbon
UI state (active tab, drawer open) is added to the same root context
provider Phase 1 introduced, per [state-ownership.md](./state-ownership.md).

### Phase 4 — Persistence

[persistence.md](./persistence.md).

Once Phase 2 produces compositions worth keeping, the data-loss risk of
having no save/reload becomes real. Its only real dependency is "whatever the
document shape currently is" — `schemaVersion` + migrations exist precisely
so this doesn't have to wait for the schema to stop changing. Can start as
early as Phase 1 in practice (see Parallelization).

### Phase 5 — Tone.js migration (`PolySynth` piano)

[libraries.md](./libraries.md) (Tone.js), rewriting [audio-engine.md](./audio-engine.md).

Audio quality, not core logic — nothing in Phases 1–4 depends on which audio
engine is underneath. Splits into two dependency-distinct pieces: the
`Tone.Transport`/`PolySynth`/scheduler core (per
[libraries.md](./libraries.md#tonejs--adopt-but-its-a-rewrite-not-just-an-addition))
has no dependency on the ribbon or Sound drawer at all and can start as
early as Phase 1 in practice; **wiring the Sound drawer's Instrument/Volume/
Envelope/Filter controls to that engine** is what should wait for Phase 3's
Sound drawer shape to be stable, so that wiring isn't done twice against a
moving UI target. Ships with the `Tone.PolySynth` default piano from
[libraries.md](./libraries.md#mvp-default-instrument-tonepolysynth-over-tonesynth),
not sampled instruments — those are real future work, deliberately kept off
this roadmap until the baseline UX above it is proven out.

### Phase 6 — Timeline infrastructure + Scale track

[timeline.md](./timeline.md), [tracks.md](./tracks.md) (scale track only).

The generic `EventTrack<T>`/`activeEventAt` abstraction, tempo/time-signature
tracks, and the scale track's context-aware highlighting — the trickiest UI
spec in the whole set (per-segment bands, not a single global highlight set).
This unlocks scale-aware transforms (`mode-shift`, `reharmonization`, which
need `SelectionContext.activeScales`) and `generate-chords`'s
`source: 'chord-track'` path as an upgrade over `selection-derived`.
Deliberately after Phase 2–5: nothing in the priority use case blocks on it.

### Phase 7 — Chord track + Labels track

[tracks.md](./tracks.md) (chord, labels).

Chord track reuses the scale track's lane/segment machinery from Phase 6, so
it's cheaper once that exists. Gives `generate-chords` a proper harmonic
source instead of inferring one from melody notes, and unlocks chord-tone
highlighting and tension-checking. Labels track is small and can slot in
whenever.

### Phase 8 — Command palette

[command-palette.md](./command-palette.md).

Already scoped as deferred; low complexity once the registry is populated
from Phase 2 onward — mostly a second renderer over data that already
exists.

### Phase 9 — Arranger track, v1 then beyond

[tracks.md](./tracks.md) (arranger).

The annotation-only v1 (add/move/resize/rename a labeled region, no content
ripple) is cheap once Phase 6's lane machinery exists. The content-carrying
upgrade — actually moving notes/events with a section — is gated on
resolving the ripple-vs-free-placement question in
[timeline.md](./timeline.md#ripple-semantics-open-design-question), which is
real design work, not implementation work.

### Phase 10 — Instrument layers

[layers.md](./layers.md).

Multi-instrument orchestration (choral/ensemble writing), once it's
actually prioritized: `Note.layerId`, the reorderable layer panel
(visibility/lock, another [overlay-shells.md](./overlay-shells.md)
consumer), per-layer instrument settings and audio instances, and the
`ProjectFile` schema migration. Placed last not because it's low-value, but
because nothing in the v1 single-instrument scope
([README.md](./README.md#scope)) blocks on it, and `selection.md`'s
`activeLayers` field costs nothing to have specified early even though its
real payoff — multi-voice selection across layers — only lands here.

---

## Not phases — ongoing or reactive

- **[accessibility.md](./accessibility.md)** — applies to every phase's
  components as they're built, not a phase of its own.
- **[testing-strategy.md](./testing-strategy.md)** — tests land with each
  phase's PRs; the 80% coverage gate is worth actually wiring up around the
  end of Phase 2, once the registry/history/selection logic it targets
  exists in volume.
- **[performance.md](./performance.md)** — explicitly trigger-condition-based
  (real lag observed, not a hypothetical). Shouldn't be preemptively
  addressed by this roadmap.

---

## Parallelization

If you and your friend are splitting work, these pairs have a narrow enough
interface to develop concurrently rather than sequentially:

- **Phase 2 (commands) ‖ Phase 3 (ribbon)** — the shared interface is just
  the `CommandDescriptor` shape from `transformations.md`, which is already
  fully specified. One person can build ribbon rendering against a couple of
  stub commands while the other implements the real command catalog.
- **Phase 4 (persistence) ‖ almost anything** — its only dependency is "the
  document shape so far," and it doesn't gate any other phase. Good
  standalone track for whoever isn't on the critical path at any given time.
- **Phase 5's engine core (Tone.js/`PolySynth`) ‖ Phases 1–4** — the
  `Transport`/scheduler/synth rewrite itself is fully isolated from the
  selection/history/transform/persistence work and touches only `audio.ts`,
  not the Sound drawer, so it doesn't need to wait on Phase 3. Only the
  later step of wiring Sound drawer controls to that engine has a real
  Phase 3 dependency, per Phase 5's own description above.

---

## Decisions this roadmap surfaces but doesn't make

- **Tone.js timing** (Phase 5's position is a suggestion, not a resolution)
  — see [libraries.md](./libraries.md#tonejs--adopt-but-its-a-rewrite-not-just-an-addition).
- **Arranger ripple semantics**, needed before Phase 9's content-carrying
  upgrade — see [timeline.md](./timeline.md#ripple-semantics-open-design-question).
