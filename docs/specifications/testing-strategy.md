# Testing Strategy Specification

## Status

This fixes targets and scope now so they aren't re-argued per PR later — it
is **not** an action item to wire up today. No CI coverage gate should be
configured yet: the codebase is still mostly the piano-roll prototype, and an
80% threshold means nothing until the command registry, timeline, and
selection modules from this directory actually exist. When implementation
begins, tests are written alongside each feature's PR, same as any other
normal development — this document is not a separate testing phase bolted on
at the end.

---

## Three layers, three tools already in `package.json`

| Layer | Tool | Target |
| --- | --- | --- |
| Unit | Vitest + `@vitest/coverage-v8` | 80% *meaningful* coverage of non-UI logic |
| Component | Storybook + `@storybook/addon-a11y` | Every stateful component, all meaningfully distinct states, zero a11y violations |
| Integration/E2E | Playwright | Cross-component flows, responsive behavior, keyboard-driven accessibility |

---

## Vitest: 80% *meaningful* coverage

"Meaningful" is the operative word — chasing 80% line coverage by testing
trivial Svelte template branches or pass-through getters produces a padded
number with no real value. The target applies to the logic-heavy, UI-
independent modules these specs already isolate as pure functions,
specifically because they're pure and therefore cheap to test thoroughly:

- **timeline.md** — `activeEventAt`, the per-segment computation behind
  context-aware highlighting
- **tracks.md** — `pitchClassesForChord`, `tensionPitchClasses`, the
  scale/chord segment intersection
- **transformations.md** — every command's `run()` and `isApplicable()`,
  each with real input→output cases, not just "doesn't throw": retrograde
  reverses note order and preserves total duration; augmentation at ratio 2
  exactly doubles every duration; `euclidean-rhythm` produces the correct
  step pattern for known `(steps, pulses, rotation)` triples
- **command-history.md** — `CommandHistory`: record/undo/redo, the redo
  stack clearing on a new record, max-depth eviction, undo-on-empty-stack
  being a no-op
- **selection.md** — `SelectionContext` derivation (count/pitchRange/
  beatRange/isContiguous) across known note sets, including edge cases:
  empty selection, single note, notes with time gaps
- **persistence.md** — the migration chain, each step in isolation and
  `loadProjectFile` applying several in sequence
- **the music-theory adapter** ([libraries.md](./libraries.md#recommendation-wrap-it-dont-spray-it))
  — test the adapter's own translation logic (MIDI number ↔ tonal note name,
  this app's `ScaleEvent`/`ChordEvent` ↔ tonal calls), not tonal.js's own
  internals, which are already someone else's tested code

Edge cases carry more weight than the percentage itself: boundary values
(transpose at the top/bottom of the MIDI range, an empty selection, importing
a file at the oldest supported `schemaVersion`) matter more than a second
happy-path test of something already covered once.

`.svelte.ts` singleton modules (the `store.svelte.ts` pattern) are tested by
calling their exported functions directly — no component mount needed for
state-machine logic that doesn't render anything itself.

---

## Storybook: component coverage, accessibility as a gate

Every component a spec in this directory introduces gets a story per
*meaningfully distinct state*, not just a default render:

| Component | States worth a story each |
| --- | --- |
| RibbonButton | enabled, disabled-with-reason, icon-only (tablet/mobile) |
| CommandParamsForm | one per `ParamField` type — number/stepper, range/slider, select, boolean |
| BottomSheet / SideDrawer | open, drag-dismiss in progress (mobile), focus-trapped |
| NoteGrid | empty, populated, selection states (single/multi/marquee-in-progress), scale-highlight segment boundaries |
| PianoKeys | default range, mid-playback key-highlight |
| EventTrackLane | one per track type it's parameterized for (scale/chord/labels/arranger) |
| Sound drawer | bottom sheet (mobile), side drawer (tablet/desktop) — per [overlay-shells.md](./overlay-shells.md#shell-contract) |

`@storybook/addon-a11y` runs against every story, and violations are meant
to block merge once this is actually wired up — the same "not yet" as
[Status](#status) above applies here too, not just to the 80% Vitest
threshold. This document specifies what
[accessibility.md](./accessibility.md#process) refers to only in general
terms ("an a11y pass... before merging"): the concrete mechanism (this
addon, against every Storybook story) that a *future* CI gate would enforce,
once real components exist for it to run against.

---

## Playwright: what the other two layers can't reach

Unit tests check logic in isolation; Storybook checks one component's own
states. Playwright covers behavior that only exists *across* components, or
depends on real browser mechanics (viewport size, focus order, IndexedDB):

- Full flow: create notes → select → apply a transform → undo → redo, in the
  actually-rendered grid
- Responsive behavior: the ribbon collapsing/expanding correctly across the
  desktop/tablet/mobile breakpoints from
  [ribbon.md](./ribbon.md#responsive-behavior) — Playwright's viewport
  emulation is a good fit for this
- Parameter drawer: bottom sheet at mobile viewport width vs. side drawer at
  desktop width, triggered by the same command
- Persistence round-trip ([persistence.md](./persistence.md)): create notes,
  reload, confirm autosave restored them; export a project file, clear the
  document, import it back, confirm equivalent state
- Keyboard-only accessibility flows: tab through the ribbon in the correct
  roving-tabindex order, invoke a command via keyboard, `Escape` closes a
  drawer/palette and restores focus to the invoking control — this is
  *behavioral* accessibility that a static per-component a11y scan can't
  catch, since it's about an interaction sequence, not one rendered state

### Full-page accessibility scans

Storybook's addon catches per-component violations; a full-page scan (e.g.
via `@axe-core/playwright`) on a few key assembled screens — ribbon + grid +
sound drawer together — catches issues that only emerge from composition
(two individually-fine components producing a heading-order or landmark
violation together). `@axe-core/playwright` isn't in `package.json` yet —
add it when this work is actually scheduled, not now.

---

## Future Work

- Visual regression testing — `@chromatic-com/storybook` is already a
  dependency; whether/when to actually turn it on is an open follow-up, not
  decided here
- Performance/load testing for large documents — see
  [performance.md](./performance.md)
