# Direct Manipulation & Quick-Apply Specification

## Overview

[generators.md](./generators.md)'s UX principles already commit to direct
manipulation — draggable time/pitch bounds instead of numeric fields, "the
grid remains the composition surface," every drag has a keyboard equivalent
([generators.md §16](./generators.md#16-accessibility)). What that spec
doesn't yet cover is the case this document exists for: the user already has
notes **selected** and wants to run an operator — arpeggiate, euclidean
rhythm, ostinato, or an ordinary transform like invert — against exactly
those notes, right now, without placing a new bounded region or opening the
recipe inspector.

This is the vector-graphics analogy: notes are the geometry. You draw them,
generate them from constraints, copy/paste them — however they got on the
canvas, once selected they're just shapes you apply an operation to. A
selection's own extent already tells the system everything a "region" would
otherwise ask for, so nothing should ask again.

This spec sits between [transformations.md](./transformations.md) (one-shot
commands) and [generators.md](./generators.md) (bounded multi-node sessions):
it's the fast front door that applies to both when a selection already
exists, deferring to the heavier session model only when an operator
genuinely needs a multi-node recipe or a freshly-placed region. It depends on
[selection.md](./selection.md)'s `SelectionContext`,
[command-history.md](./command-history.md)'s one-entry-per-gesture model, and
[accessibility.md](./accessibility.md)'s drag-has-a-keyboard-equivalent rule.

---

## Core principle: the selection rectangle _is_ the bounds field

`SelectionContext.pitchRange` / `beatRange` ([selection.md](./selection.md#selectioncontext--what-transformations-actually-read))
already carries exactly what [`GeneratorBounds`](./generators.md#43-generator-bounds)
needs. When an operator runs against an existing selection, its bounds
default to that selection's own extent — no `octaveRange`/`targetRange`
drawer fields duplicate what's already on screen as the selection.

If the user wants to generate _beyond_ what's currently selected (e.g. an
arpeggio that should span two octaves from a one-octave chord), the
selection's bounding rectangle grows drag handles — the same handles
`generators.md` already specifies for a placed region, just initialized from
the selection instead of a fresh drop. Dragging a handle is the only way to
widen scope; there is no separate numeric min/max field for it. This is the
concrete rule behind "the panel should be reserved only for things that
can't be expressed through direct manipulation": bounds are never a
panel-worthy param, because they're always expressible as a rectangle.

---

## Quick-apply: one flat list, instant default result

Extends [command-palette.md](./command-palette.md): the palette lists every
`CommandDescriptor` and `GeneratorDescriptor` whose `isApplicable(ctx)` is
true for the current selection, in one flat, searchable, un-tabbed list — not
split across ribbon tabs. Selecting an entry runs it **immediately** using
`getDefaultParams(ctx)` (generators) or each field's `default` (commands)
against the current selection — the same one-node-recipe-evaluated-inline
path `generators.md`'s `createDefaultRecipe`/`evaluateGeneratorRecipe`
already defines, just invoked without opening the session UI around it. No
drawer opens for the common case; the notes on the grid update and that's the
whole interaction.

This does not change either descriptor's underlying contract
([transformations.md](./transformations.md#command-descriptor),
[generators.md §5](./generators.md#5-proposed-generator-api)) — it's a third
invocation path alongside "one-click command" and "open the full session,"
available specifically when `ctx` already has a non-empty selection.

---

## Semi-live tweak, then bake

Applying an operator doesn't have to be the end of the interaction. The
**most recently applied** operator stays parametric — its params reachable
through the on-canvas affordances below — until any of:

- another operator is applied (stacking the next transform on the result),
- the selection changes,
- the user starts an unrelated gesture elsewhere on the grid.

At that point it flattens into ordinary notes. This is deliberately not the
fully non-destructive model ([generators.md §12](./generators.md#12-v1-persistence-decision-and-feasibility-analysis)
rules that out for the same reason here: provenance tracking and
recompute-on-upstream-change are real engine cost this doesn't need) — only
the _last_ op is ever live, matching the existing one-active-session
constraint generators already have.

**History**: per [command-history.md](./command-history.md#one-history-entry-per-gesture)'s
"one `record()` per discrete user action" rule, the whole
apply→tweak→bake sequence is one gesture, not one entry per tweak. The
pre-op snapshot is captured once, at first apply; every tweak recomputes
`run()`/`evaluateGeneratorRecipe` fresh from that same snapshot (never from
the previous tweak's output); `record()` fires once, at bake, with the
final params' result. Undo afterward removes the whole applied-and-tweaked
result in one step, same as any other command today.

---

## Param affordance tiers

Every `ParamField` an operator declares falls into one of three tiers. Most
of today's catalog ([transformations.md](./transformations.md#initial-catalog),
[generators.md §9](./generators.md#9-generator-families-and-initial-catalog))
is tier I or II — tier III should be the exception, not the default landing
spot it is today via the parameter drawer.

### Tier I — spatial: the selection's own bounds handles

Anything that's already a time/pitch extent. Covered above; never a form
field.

### Tier II — scrub + keyboard: the notes are the control

Small numeric/discrete params that aren't spatial — arpeggiate's `pattern`,
euclidean's `gate`, jitter's amounts. Two equivalent input paths, required
together (not one with the other as a fallback), per
[generators.md §16](./generators.md#16-accessibility)'s "every draggable item
has an equivalent [...] action" and this project's broader accessibility
baseline:

- **Scrub**: click-drag directly on the selected notes changes the value —
  e.g. vertical drag cycles `pattern` through its options, horizontal drag on
  a step scrubs `gate`. No separate widget renders; the notes themselves are
  the control surface, same spirit as a DAW's alt-drag numeric scrub.
- **Keyboard**: while the operator is the live/tweakable one (per the bake
  section above), a dedicated key cycles the same param one step per press.
  This is not a "screen-reader alternative" bolted on separately — it's the
  same control, second input method, satisfying
  [accessibility.md](./accessibility.md#piano-roll--note-grid)'s baseline for
  users who can't do pointer-precision drags at all, not only screen-reader
  users.

A screen-reader announcement of the new value on every change (scrub or
keyboard) reuses the existing `aria-live` pattern from
[accessibility.md §Screen reader announcements](./accessibility.md#screen-reader-announcements).

### Tier III — panel, last resort

Params that are neither spatial nor a single scrubbable scalar — an enum
with more than a couple of options where cycling would be tedious (e.g.
`voicingStrategy`), or a structural toggle like `generate-chords`'s
`source: 'chord-track' | 'selection-derived'`. These keep using the existing
[overlay-shells.md](./overlay-shells.md) drawer. The bar for "belongs in the
drawer" is now "cannot be reasonably expressed as tier I or II," not "every
param the descriptor happens to declare."

---

## Worked example: euclidean-rhythm

`steps`/`pulses`/`rotation` ([generators.md §9.1](./generators.md#euclidean-rhythm))
become a literal on-canvas step overlay over the selection: a row of
toggleable cells, click to add/remove a pulse, drag to rotate. This replaces
all three numeric fields at once — the overlay both edits and displays the
pattern, so it doubles as documentation of what's currently applied.
`gate` stays tier II (a horizontal scrub axis on the same overlay).
`stepBeats` is tier I once `steps` is fixed by the overlay's cell count and
the selection's own beat span. This is the flagship case for why tier
classification matters: a naive reading of `EuclideanRhythmParams` as "three
numbers and an enum" would send all of it to the drawer; the actual
parameter _shape_ (a bounded set of discrete on/off positions) has a much
better direct-manipulation form than a form ever would.

---

## Relationship to the full generator session

This quick-apply path does not replace
[generators.md's bounded-region, multi-node session](./generators.md#41-generator-family) —
that remains the right tool for composing a multi-stage recipe (chord source
→ voicing → arpeggiate → euclidean gate) or generating material into empty
space with no starting selection. Both paths share the same operator
catalog and evaluator underneath; quick-apply is simply
`createDefaultRecipe(ctx)` (or a command's `run()`) invoked inline against a
selection instead of behind the full inspector. A user who starts on
quick-apply and wants more control than the on-canvas affordances give them
should have an explicit escape hatch ("Open in generator session") that
hands the same recipe to the full inspector — not a dead end.

---

## Explicitly deferred

- **Polymeters against the harmonic lattice.** A polymeter's cycle length is
  independent of the chord track's own bar/chord structure — genuinely not a
  selection-bounds question, and not obviously tier I, II, or III as defined
  above. Resolved for now as: ship quick-apply for the operators already
  named here first; polymeter gets a numeric (tier III) param until this
  system is proven, then its own affordance design (most likely a second,
  independent draggable-length ruler overlay against the timeline).
- Tier II's exact scrub-gesture-per-param-type mapping (which axis, which
  direction means increase) — belongs in [piano-roll.md](./piano-roll.md) or
  its own interaction-gesture table once a first operator (euclidean-rhythm)
  is actually built against this spec.
- Whether quick-apply's flat palette list and
  [command-palette.md](./command-palette.md)'s `Ctrl/Cmd+K` overlay are the
  same UI surface or two entry points into the same registry query — this
  doc assumes the latter but doesn't mandate it.
