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
type ParamField =
	| { key: string; type: 'number'; label: string; min?: number; max?: number; step?: number; default: number }
	| { key: string; type: 'range'; label: string; min: number; max: number; step?: number; default: number }
	| { key: string; type: 'select'; label: string; options: { value: string; label: string }[]; default: string }
	| { key: string; type: 'boolean'; label: string; default: boolean };

interface CommandDescriptor<TParams extends Record<string, unknown> = Record<string, never>> {
	id: string; // stable, kebab-case — e.g. "transpose"
	category: 'transform' | 'generate' | 'export' | 'view' | 'transport';
	labelKey: string; // Paraglide message key, not a raw string — see ribbon.md i18n
	descriptionKey?: string;
	icon: string; // icon identifier, resolved by the ribbon's icon set
	keywords?: string[]; // extra terms for command-palette search
	shortcut?: string;
	params?: ParamField[]; // omitted = one-click command, no drawer
	isApplicable(ctx: SelectionContext): boolean;
	run(ctx: SelectionContext, params: TParams): { notes: Note[]; label: string };
}
```

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
- `run()` returns the **replacement note set** (destructive, per
  [command-history.md](./command-history.md)) plus a human-readable `label`
  used for the undo-stack entry. Every note in that set must satisfy the
  invariants in [editing-model.md](./editing-model.md#invariants-every-mutation-must-uphold)
  — `transpose` and other pitch-shifting commands are responsible for
  clamping to `[MIN_MIDI, MAX_MIDI]` themselves; nothing does it for them.
- `isApplicable()` is the enablement predicate — see below.

### The registry itself

```typescript
// registry/index.svelte.ts
export const commandRegistry: CommandDescriptor[] = [
	...transformCommands,
	...generateCommands,
	...exportCommands
];
```

A plain array is sufficient — the registry is authored, not runtime-mutated,
so it doesn't need `$state`. Reactivity lives in the *derived* per-command
`enabled` flag (`$derived(command.isApplicable(selectionContext))`), computed
where a command is rendered (ribbon button, palette row), not in the registry
itself. Splitting `transformCommands`/`generateCommands`/`exportCommands` into
their own files (one file per command or small family of commands) keeps the
registry itself a thin index — the natural seam for future external
contributions.

---

## Applicability

Each command's `isApplicable(ctx: SelectionContext)` encodes its own minimum
requirements — there's no shared "selection is non-empty" gate imposed
centrally, because some generators (Euclidean rhythm, ostinato) don't need a
selection at all, they need an insertion point. Examples:

| Command      | Applicability rule                                  |
| ------------ | ---------------------------------------------------- |
| Retrograde   | `ctx.count >= 1`                                     |
| Inversion    | `ctx.count >= 1`                                     |
| Permutation  | `ctx.count >= 2`                                     |
| Fragmentation| `ctx.count >= 2`                                     |
| Re-harmonization | `ctx.count >= 1 && ctx.activeScales.length === 1` |
| Euclidean rhythm generator | always applicable (writes to the playhead/insertion beat, not the selection) |

When a command is disabled, both the ribbon button and the palette row stay
visible but greyed out with a reason (e.g. "Select at least 2 notes") rather
than disappearing — discoverability over minimalism, and it's what makes the
palette useful as a way to *learn* what's possible.

---

## Initial catalog

Sketched at the level of id + params — full algorithm design for each is out
of scope for this document and happens per-command as it's implemented.

### Transform

| id | Params |
| --- | --- |
| `transpose` | `semitones: number` |
| `invert` | `pivot: 'first-note' \| 'selection-center' \| 'custom'`, `customPivot?: number` |
| `retrograde` | — |
| `augmentation` | `ratio: number` (e.g. 2 = double durations) |
| `diminution` | `ratio: number` |
| `metric-modulation` | `ratio: number`, `requantize: boolean` |
| `fragmentation` | `fragmentBeats: number` |
| `truncation` | `keepBeats: number` |
| `expansion` | `insertBeats: number` |
| `reharmonization` | `strategy: 'select'`, `targetScale: string` |
| `mode-shift` | `targetMode: 'select'` |
| `voice-leading-adapt` | `targetChord: string` |
| `permutation` | `seed: number` |
| `jitter` | `timeAmount: range`, `pitchAmount: range`, `velocityAmount: range`, `seed: number` |
| `duplicate-selection` | — see [editing-model.md](./editing-model.md#duplicate-in-place-repeat-this-phrase) |

### Generate

| id | Params |
| --- | --- |
| `arpeggiate` | `pattern: 'up' \| 'down' \| 'up-down' \| 'random'`, `rateBeats: number` |
| `euclidean-rhythm` | `steps: number`, `pulses: number`, `rotation: number` |
| `motif-generate` | `lengthBeats: number`, `seed: number` |
| `ostinato-generate` | `lengthBeats: number`, `repeats: number` |
| `generate-chords` | `octaveRange: { min, max }`, `voiceCount: number`, `voicingStrategy: 'closed' \| 'open' \| 'drop2' \| 'smooth-voice-leading'`, `source: 'chord-track' \| 'selection-derived'` |

#### `generate-chords` is the priority v1 case

This is the command behind "generate chords with voice leading in a
particular octave while I write melody on the same timeline": it **writes new
notes** into the shared `Note[]` collection — it doesn't touch the melody
notes at all, and the melody isn't required to be selected while it runs.
Two source modes:

- `source: 'chord-track'` — reads the active `ChordEvent` at each beat in the
  target range from the [chord track](./tracks.md#chord-track-placeholder),
  takes its `pitchClasses` (not the `quality` label — see
  [tracks.md](./tracks.md#chordevent-carries-a-pitch-class-set-not-just-a-label)),
  and voices those pitch classes within `octaveRange`, smoothing voice
  movement between consecutive chords per `voicingStrategy`.
- `source: 'selection-derived'` — no chord track yet: infer a chord per beat
  from whatever melody notes are selected in that range (a much rougher
  harmonization heuristic), then voice it the same way. Useful before the
  chord track exists, and worth keeping even after, for a quick "harmonize
  this melody" pass.

This is distinct from `reharmonization` (recolors the harmony of *existing*
selected notes in place) and `voice-leading-adapt` (nudges *existing* selected
chord notes toward smoother voice leading against a target) — both of those
transform notes that already exist; `generate-chords` adds notes that didn't
exist before. All three can reasonably share the same underlying
voice-leading math, just applied to different inputs.

### Export

Already partially implemented (`midi-export.ts`) — folding it into the
registry means "Export MIDI" becomes a `CommandDescriptor` like any other,
which is what lets it appear in both the ribbon's Export tab and the palette
without special-casing.

| id | Params |
| --- | --- |
| `export-midi` | — (exists today, outside the registry) |
| `export-project` | — writes the full round-trippable project file, see [persistence.md](./persistence.md) |
| `import-project` | — opens a file picker; confirms before discarding unsaved changes, see [persistence.md](./persistence.md) |

---

## Execution flow

1. **One-click command** (no `params`): clicking the ribbon button or palette
   row calls `history.record(label, snapshot)` then `command.run(ctx, {})`
   immediately, applying the result.
2. **Parameterized command**: clicking opens the parameter drawer
   ([ribbon.md](./ribbon.md#parameter-drawer)) with `$state` bound to each
   field's `default`. "Apply" performs the same record-then-run as above using
   the drawer's current values; "Cancel" discards the drawer state with no
   history entry.

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
