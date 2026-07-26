# Transformations & Generators Specification

## Overview

A **declarative command registry** drives both the ribbon and the (later)
command palette from one source of truth, so adding a new transform or
generator — including ones contributed by someone other than the original
author — never requires touching ribbon UI code. This document specifies the
registry shape and catalogs the initial set of commands; it depends on
[selection.md](./selection.md) for what a command reads and
[command-history.md](./command-history.md) for how a command's effect becomes
undoable.

---

## Command descriptor

```typescript
interface ParamFieldBase {
  key: string;
  label: string;
  // Omitted = always shown. Present = the drawer re-evaluates this against
  // the current in-progress values on every change, hiding the field when
  // it returns false — e.g. `invert`'s customPivot only makes sense once
  // `pivot === 'custom'` is chosen.
  showIf?: (values: Record<string, unknown>) => boolean;
}

type ParamField =
  | (ParamFieldBase & {
      type: 'number';
      min?: number;
      max?: number;
      step?: number;
      default: number;
    })
  | (ParamFieldBase & { type: 'range'; min: number; max: number; step?: number; default: number })
  | (ParamFieldBase & {
      type: 'select';
      options: { value: string; label: string }[];
      default: string;
    })
  | (ParamFieldBase & { type: 'boolean'; default: boolean })
  // A paired min/max value, e.g. generate-chords's octaveRange — distinct
  // from 'range' above, which is one continuous value on a single slider.
  | (ParamFieldBase & {
      type: 'number-range';
      min: number;
      max: number;
      step?: number;
      default: { min: number; max: number };
    });

interface CommandDescriptor<TParams extends Record<string, unknown> = Record<string, never>> {
  id: string; // stable, kebab-case — e.g. "transpose"
  category: 'transform' | 'generate' | 'export' | 'view' | 'transport';
  labelKey: string; // Paraglide message key, not a raw string — see ribbon.md i18n
  descriptionKey?: string;
  icon: string; // icon identifier, resolved by the ribbon's icon set
  keywords?: string[]; // extra terms for command-palette search
  shortcut?: string;
  params?: ParamField[]; // omitted = one-click command, no drawer
  isApplicable(ctx: CommandContext): boolean;
  // Only consulted when isApplicable(ctx) is false, to drive the disabled
  // tooltip (e.g. "Select at least 2 notes"). Separate from isApplicable
  // rather than folded into a richer return type so every existing
  // `ctx.count >= 1`-style boolean rule stays exactly as terse as written
  // below — most commands' disabled state is self-explanatory from their
  // label plus the ribbon's own selection-count display, and can skip
  // this; a generic labelKey (e.g. "Not available for this selection")
  // is the fallback when a command omits it.
  getDisabledReasonKey?(ctx: CommandContext): string;
  // Exactly one of `run` or `effect` — see "Export commands are effects,
  // not transforms" below for why file I/O can't go through `run()`.
  run?(ctx: CommandContext, params: TParams): { notes: Note[]; label: string };
  effect?(ctx: CommandContext, params: TParams): Promise<void>;
}
```

`ParamFieldBase.showIf` and the `'number-range'` variant both exist because
the catalog below already needs them, not speculatively: `invert`'s
conditional `customPivot` needs `showIf`, and `generate-chords`'s
`octaveRange: { min, max }` needs `'number-range'` — a command's declared
`params: ParamField[]` couldn't otherwise represent either one, which would
have quietly broken the "catalog drives an auto-generated drawer" promise
for exactly the two commands most central to the priority use case.

### `CommandContext`: `SelectionContext` plus what generators need

Most commands only ever read the selection, but not all of them — the
catalog below already assumes more than [`SelectionContext`](./selection.md#selectioncontext--what-transformations-actually-read)
provides: the Euclidean rhythm generator writes at "the playhead/insertion
beat, not the selection" (see Applicability below), and `generate-chords`'s
`source: 'chord-track'` mode reads the chord track directly. Since `run()`
must stay pure — per [architecture.md](./architecture.md#four-layers-named-the-svelte-idiomatic-way),
it can't reach into Application-state singletons (`store`, the chord track)
on its own — anything a command needs has to arrive through its context
parameter, not be fetched inside `run()`. `CommandContext` extends
`SelectionContext` with exactly the additional fields the current catalog
needs, so existing references like `ctx.count` and `ctx.activeScales`
continue to work unchanged:

```typescript
interface CommandContext extends SelectionContext {
  allNotes: Note[]; // the whole document's notes, not just the selection — see run()'s return contract below
  playhead: number; // current playhead beat — where a selection-free generator (Euclidean rhythm, ostinato) inserts
  chordTrack: ChordEvent[]; // full track; generate-chords (source: 'chord-track') resolves its own target range from this plus `playhead`/`beatRange`
}
```

This is computed alongside `selectionContext` in the same `$derived.by`
scope (per [selection.md](./selection.md#selectioncontext--what-transformations-actually-read)),
just widened by two more reads from existing Application-state — it isn't a
second, separately-maintained derivation.

- `params` is what auto-generates the parameter drawer described in
  [ribbon.md](./ribbon.md#parameter-drawer) — a command author declares fields
  declaratively and gets a working UI for free, rather than building a
  bespoke form per command. On mobile, a `'number'` field with a small
  range and `step` (e.g. `transpose`'s semitones, `augmentation`'s ratio)
  renders as a stepper (−/+ buttons around the value) rather than a bare
  numeric input — easier to hit precisely with a thumb than typing on a
  virtual keyboard. `'range'` fields (continuous amounts, e.g. `jitter`'s
  time/pitch/velocity amounts) stay sliders on every device. This is a
  rendering choice per field `type`, not a new schema field.
- `run()`'s returned `notes` is the **complete replacement for the whole
  document's `Note[]`** — not just the notes a command touched — matching
  [command-history.md](./command-history.md#generalising-beyond-note)'s
  whole-document-snapshot philosophy: applying a result is always a single
  `store.notes = result.notes` assignment, with no per-command "how do I
  splice this back in" logic. In practice a command builds this from
  `ctx.allNotes`: a selection-transform (`transpose`, `invert`, ...) returns
  `[...ctx.allNotes.filter((n) => !selectedIds.has(n.id)), ...transformed]`;
  a pure-insertion generator (`generate-chords`, `arpeggiate`) returns
  `[...ctx.allNotes, ...newNotes]` unchanged plus its additions — see
  `generate-chords`'s own section below for the concrete case. Every note in
  the returned set must satisfy the invariants in
  [editing-model.md](./editing-model.md#invariants-every-mutation-must-uphold)
  — `transpose` and other pitch-shifting commands are responsible for
  clamping to `[MIN_MIDI, MAX_MIDI]` themselves; nothing does it for them.
- `isApplicable()` is the enablement predicate — see below.

### The registry itself

```typescript
// registry/index.svelte.ts
export const commandRegistry: CommandDescriptor[] = [
  ...transformCommands,
  ...generateCommands,
  ...exportCommands,
];
```

A plain array is sufficient — the registry is authored, not runtime-mutated,
so it doesn't need `$state`. Reactivity lives in the _derived_ per-command
`enabled` flag (`$derived(command.isApplicable(selectionContext))`), computed
where a command is rendered (ribbon button, palette row), not in the registry
itself. Splitting `transformCommands`/`generateCommands`/`exportCommands` into
their own files (one file per command or small family of commands) keeps the
registry itself a thin index — the natural seam for future external
contributions.

`category` includes `'view'` and `'transport'` even though no `viewCommands`/
`transportCommands` array exists yet — those categories are intentionally
unpopulated for now. Play/Stop, snap, and the velocity-lane toggle are still
hardcoded Quick Access Bar/Toolbar chrome per
[ribbon.md](./ribbon.md#quick-access-bar-stays-separate), not registry
commands, until [command-palette.md](./command-palette.md#non-transform-commands)'s
deferred milestone gives them a reason to become one (so they're invocable
from the palette too). When that happens, the new array joins the spread
above the same way `exportCommands` already did — the registry doesn't need
to anticipate them before there's a command to put in them.

---

## Applicability

Each command's `isApplicable(ctx: CommandContext)` encodes its own minimum
requirements — there's no shared "selection is non-empty" gate imposed
centrally, because some generators (Euclidean rhythm, ostinato) don't need a
selection at all, they need an insertion point. Examples:

| Command                    | Applicability rule                                              |
| -------------------------- | --------------------------------------------------------------- |
| Retrograde                 | `ctx.count >= 1`                                                |
| Inversion                  | `ctx.count >= 1`                                                |
| Permutation                | `ctx.count >= 2`                                                |
| Fragmentation              | `ctx.count >= 2`                                                |
| Re-harmonization           | `ctx.count >= 1 && ctx.activeScales.length === 1`               |
| Euclidean rhythm generator | always applicable (writes at `ctx.playhead`, not the selection) |

When a command is disabled, both the ribbon button and the palette row stay
visible but greyed out with a reason (e.g. "Select at least 2 notes") rather
than disappearing — discoverability over minimalism, and it's what makes the
palette useful as a way to _learn_ what's possible. The reason text comes
from `CommandDescriptor.getDisabledReasonKey(ctx)` above, not from
`isApplicable` itself — a boolean alone has no channel to carry a specific
explanation, and most commands can rely on the generic fallback rather than
writing their own.

---

## Initial catalog

Sketched at the level of id + params — full algorithm design for each is out
of scope for this document and happens per-command as it's implemented.

### Transform

| id                    | Params                                                                             |
| --------------------- | ---------------------------------------------------------------------------------- |
| `transpose`           | `semitones: number`                                                                |
| `invert`              | `pivot: 'first-note' \| 'selection-center' \| 'custom'`, `customPivot?: number`    |
| `retrograde`          | —                                                                                  |
| `augmentation`        | `ratio: number` (e.g. 2 = double durations)                                        |
| `diminution`          | `ratio: number`                                                                    |
| `metric-modulation`   | `ratio: number`, `requantize: boolean`                                             |
| `fragmentation`       | `fragmentBeats: number`                                                            |
| `truncation`          | `keepBeats: number`                                                                |
| `expansion`           | `insertBeats: number`                                                              |
| `reharmonization`     | `strategy: 'select'`, `targetScale: string`                                        |
| `mode-shift`          | `targetMode: 'select'`                                                             |
| `voice-leading-adapt` | `targetChord: string`                                                              |
| `permutation`         | `seed: number`                                                                     |
| `jitter`              | `timeAmount: range`, `pitchAmount: range`, `velocityAmount: range`, `seed: number` |
| `duplicate-selection` | — see [editing-model.md](./editing-model.md#duplicate-in-place-repeat-this-phrase) |

### Generate

| id                  | Params                                                                                                                                                                                                                                                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `arpeggiate`        | `pattern: 'up' \| 'down' \| 'up-down' \| 'random'`, `rateBeats: number`                                                                                                                                                                                                                                                                             |
| `euclidean-rhythm`  | `steps: number`, `pulses: number`, `rotation: number`                                                                                                                                                                                                                                                                                               |
| `motif-generate`    | `lengthBeats: number`, `seed: number`                                                                                                                                                                                                                                                                                                               |
| `ostinato-generate` | `lengthBeats: number`, `repeats: number`                                                                                                                                                                                                                                                                                                            |
| `generate-chords`   | `octaveRange: { min, max }`, `voiceCount: number`, `voicingStrategy: 'closed' \| 'open' \| 'drop2' \| 'smooth-voice-leading'`, `source: 'chord-track' \| 'selection-derived'`, `targetRange?: { min: number; max: number }` (beats — required for `source: 'chord-track'`; ignored for `'selection-derived'`, which uses the selection's own range) |

#### `generate-chords` is the priority v1 case

This is the command behind "generate chords with voice leading in a
particular octave while I write melody on the same timeline": it **writes new
notes** into the shared `Note[]` collection — it doesn't touch the melody
notes at all, and the melody isn't required to be selected while it runs.
Concretely, per `run()`'s whole-document contract above, this means
`{ notes: [...ctx.allNotes, ...voicedChordNotes], label: 'Generate chords' }`
— every existing note, melody or otherwise, is carried through unchanged,
and the only additions are the newly voiced chord notes. Two source modes:

- `source: 'chord-track'` — reads the active `ChordEvent` at each beat in
  `params.targetRange` from `ctx.chordTrack` (see `CommandContext` above),
  the [chord track](./tracks.md#chord-track-placeholder)'s full contents,
  resolved via [timeline.md](./timeline.md#resolving-the-active-value-at-beat-x)'s
  `activeEventAt`, takes its `pitchClasses` (not the `quality` label — see
  [tracks.md](./tracks.md#chordevent-carries-a-pitch-class-set-not-just-a-label)),
  and voices those pitch classes within `octaveRange`, smoothing voice
  movement between consecutive chords per `voicingStrategy`. `targetRange`
  is required here specifically because this mode's whole point is running
  with no melody selected — there's no `ctx.beatRange` to fall back on, so
  the range has to come from the drawer as an explicit param (rendered via
  the same `'number-range'` `ParamField` kind as `octaveRange`), defaulting
  to a sensible span from the current `ctx.playhead` if the user hasn't set
  one.
- `source: 'selection-derived'` — no chord track yet: infer a chord per beat
  from whatever melody notes are selected, using `ctx.beatRange` as the
  target range (`targetRange` is ignored in this mode — the selection
  already defines the span), then voice it the same way. Useful before the
  chord track exists, and worth keeping even after, for a quick "harmonize
  this melody" pass.

This is distinct from `reharmonization` (recolors the harmony of _existing_
selected notes in place) and `voice-leading-adapt` (nudges _existing_ selected
chord notes toward smoother voice leading against a target) — both of those
transform notes that already exist; `generate-chords` adds notes that didn't
exist before. All three can reasonably share the same underlying
voice-leading math, just applied to different inputs.

### Export

Already partially implemented (`midi-export.ts`) — folding it into the
registry means "Export MIDI" becomes a `CommandDescriptor` like any other,
which is what lets it appear in both the ribbon's Export tab and the palette
without special-casing.

| id               | Params                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| `export-midi`    | — (exists today, outside the registry)                                                                    |
| `export-project` | — writes the full round-trippable project file, see [persistence.md](./persistence.md)                    |
| `import-project` | — opens a file picker; confirms before discarding unsaved changes, see [persistence.md](./persistence.md) |

#### Export commands are effects, not transforms

All three use `effect()`, not `run()` — none of them fit "compute a
replacement `Note[]`," and forcing them to would mean either faking a
no-op notes return just to trigger a file download (a side effect,
violating [architecture.md](./architecture.md#four-layers-named-the-svelte-idiomatic-way)'s
"`run()` doesn't touch the DOM" rule) or trying to express an async file
picker and a whole-document replace as a synchronous notes computation,
which it isn't:

- `export-midi`/`export-project` never mutate the document at all — they
  read the current state and produce a file download. `effect()` does
  exactly that and returns; no `history.record()` call, since nothing
  about the document changed.
- `import-project` does replace the document, but not through the
  `run()`/`{ notes, label }` shape — it's a whole-`ProjectFile` swap (every
  track, `synthSettings`, not just `notes`), gated behind the async file
  picker, [persistence.md](./persistence.md#export--import-the-sharing-mechanism)'s
  validation/migration, and its confirm-before-discard and
  [flush-before-replace](./persistence.md#flush-before-any-document-replacing-action)
  steps. Its `effect()` is responsible for calling `history.record()`
  itself once the new document is ready to swap in — reusing
  `CommandHistory`'s existing "restore the whole snapshot" undo model
  (it's already generalized past just `Note[]`), just triggered from an
  effect instead of the standard run-then-record-then-apply flow below.

---

## Execution flow

This section describes `run()`-based commands (transform/generate) — the
common case. `effect()`-based commands (the three Export commands above)
skip this entirely: clicking calls `effect(ctx, {})` (or with drawer values,
for a parameterized effect) directly, and whatever history interaction is
appropriate, if any, happens inside that call rather than through the
steps below.

1. **One-click command** (no `params`): clicking the ribbon button or palette
   row calls `command.run(ctx, {})` immediately. `run()` is pure — per
   [architecture.md](./architecture.md#four-layers-named-the-svelte-idiomatic-way),
   it only computes a result, it doesn't touch `$state` — so calling it
   commits nothing by itself. Only on success does the caller
   `history.record(result.label, () => currentSnapshot())` (capturing the
   _pre-mutation_ document, per [command-history.md](./command-history.md#api)),
   then apply `result.notes` as the actual mutation. A thrown `run()` skips
   both steps entirely: no history entry, no state change — there's no
   window where a history entry exists for a mutation that never happened,
   or vice versa.
2. **Parameterized command**: clicking opens the parameter drawer
   ([ribbon.md](./ribbon.md#parameter-drawer)) with `$state` bound to each
   field's `default`. "Apply" performs the same run-then-record-then-apply
   sequence as above using the drawer's current values; "Cancel" discards the
   drawer state with no history entry and no `run()` call at all.

### Live preview — left open

Previewing a parameterized transform on the grid before committing (adjusting
a slider and seeing notes move live) would be a strong UX improvement,
especially for jitter/re-harmonization where the right value isn't obvious in
advance. It is **not required for v1**: applying a command and using undo to
retry with different parameters is an acceptable fallback, and building a
non-committing preview path doubles the surface area of every command's `run()`
(it needs a "would produce" mode that doesn't touch history). Revisit once the
registry and a few real commands exist and it's clear which commands would
actually benefit.

---

## Future Work

- External/contributed commands — once the registry is split into per-file
  commands, document the process for adding one without touching core files
- Live preview (see above)
- A "recently used commands" list, shared between ribbon and palette
