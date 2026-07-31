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
selection's extent already supplies the spatial information a region would
otherwise ask for. Musical source, document effect, and result-selection
semantics remain explicit operation policies.

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

## Selection semantics are independent

Using the selection rectangle as `GeneratorBounds` answers only **where** an
operation runs. It does not by itself answer:

1. whether the selected notes are musical source material;
2. whether the selected notes remain in the document;
3. which notes become selected after the operation.

Every operation offered through Quick Apply must define these behaviors
explicitly. They must not be inferred merely from whether the operation is
registered as a command or generator.

```typescript
type QuickApplySelectionRole = 'source' | 'source-and-bounds' | 'bounds-only';

type QuickApplyDocumentEffect =
  'replace-selection' | 'insert-alongside-selection' | 'modify-selection';

type QuickApplyResultSelection =
  'select-result' | 'preserve-source-selection' | 'select-source-and-result';

interface QuickApplyBehavior {
  selectionRole: QuickApplySelectionRole;
  documentEffect: QuickApplyDocumentEffect;
  resultSelection: QuickApplyResultSelection;
}
```

These types describe product behavior. The eventual implementation may place
the metadata directly on operation descriptors or resolve it through a shared
operation catalog, as specified by
[unified-operations.md](./unified-operations.md).

### Source is not the same as bounds

A selection-aware generator must actually consume the selected notes when its
behavior declares `source` or `source-and-bounds`.

For example, Quick Applying **Arpeggiate** to selected block chords must build
or configure a recipe whose harmony source is those captured notes. Merely
evaluating the ordinary chord-track recipe inside the selection's time and
pitch rectangle is not a selection transform.

A generator may use one of the following approaches:

- create a selection-specific default recipe;
- override the relevant source-node parameters before evaluation;
- use an operator whose input plan is constructed from the captured selection.

The selected source notes are captured at invocation time. Later UI selection
changes must not alter the evaluation already in progress.

If an operation has no meaningful selection-aware behavior yet, it must not be
presented as though it transforms the selected notes. It may remain available
through the full generator-session workflow for content origination.

### Document effect

Quick Apply must use the operation's declared document effect:

- `replace-selection` removes the captured source notes and commits the result;
- `insert-alongside-selection` preserves the source notes and commits additional
  material;
- `modify-selection` commits the operation's transformed form of the selected
  notes.

Examples:

| Operation                                                    | Selection role    | Document effect            |
| ------------------------------------------------------------ | ----------------- | -------------------------- |
| Transpose                                                    | source            | modify-selection           |
| Retrograde                                                   | source            | modify-selection           |
| Arpeggiate selected chords                                   | source-and-bounds | replace-selection          |
| Generate chords beneath a melody                             | source-and-bounds | insert-alongside-selection |
| Originate a Euclidean pulse pattern inside a selected region | bounds-only       | insert-alongside-selection |
| Repeat a selected motif as an ostinato                       | source-and-bounds | replace-selection          |

For the canonical Quick Apply behavior, repeating a selected motif as an
ostinato replaces the captured motif and selects the committed ostinato
result. A separate “extend motif” operation or preset may preserve the source
and append only later repetitions.

### Result selection

After a successful application, selection must update according to the
operation's declared result-selection behavior.

`select-result` is the default for operations intended to form a chain. It
allows the next Quick Apply operation to consume the newly generated or
transformed notes.

For example:

```text
Select block chord
→ Quick Apply Arpeggiate
→ generated arpeggio becomes selected
→ Quick Apply Humanize
```

Without result selection, the second operation would accidentally target the
original source notes rather than the arpeggio.

`preserve-source-selection` is appropriate when generated material is added as
support and the user's original musical object should remain the focus.
`select-source-and-result` should be used sparingly because it makes subsequent
operation scope broader.

---

## Quick-apply outcomes and history

Quick Apply must distinguish a successful document change from an empty result,
a no-op, and an evaluation failure.

```typescript
type QuickApplyOutcome =
  | {
      status: 'applied';
      /** Permanent IDs of notes produced or retained as the operation result. */
      resultNoteIds: string[];
      /** Permanent IDs removed from the document, when applicable. */
      removedNoteIds?: string[];
    }
  | {
      status: 'no-change';
      message: string;
    }
  | {
      status: 'failed';
      message: string;
      diagnostics?: OperationDiagnostic[];
    };
```

The exact runtime representation may differ, but every Quick Apply surface must
support these three outcomes. `OperationDiagnostic` is an operation-neutral
diagnostic shape shared by commands and generators; generator-specific
diagnostics may be adapted into it at the application boundary.

### Applied

In Phases 1 and 2, an `applied` outcome:

- changes document notes;
- records exactly one document-history entry;
- applies the operation's result-selection policy;
- closes the Quick Apply palette;
- announces the operation through the existing `aria-live` mechanism.

In Phase 3, successful evaluation creates or updates transient live-operation
state instead of recording history immediately. The operation records one
history entry only when it is baked.

### No change

A `no-change` outcome occurs when evaluation succeeds but produces no document
difference. Examples include:

- a chord-track generator evaluated where no chord is active;
- a transform whose default parameter leaves the notes unchanged;
- a generator that produces an empty valid plan.

A no-change outcome:

- does not record history;
- does not change selection;
- keeps the palette open;
- shows a short explanation such as “No chord is active in the selected
  range” or “The operation produced no change.”

A no-op history entry must not be used as evidence that an operation ran.

### Failed

A failed outcome:

- does not mutate document notes or history;
- keeps the palette open;
- exposes the most relevant generator or command diagnostic;
- leaves the user's query and highlighted operation intact so they can recover.

---

## Quick-apply: one flat list, instant default result

Extends [command-palette.md](./command-palette.md): the palette lists every
`CommandDescriptor` and `GeneratorDescriptor` that is applicable to the
current context **and declares a valid Quick Apply behavior for that
context**, in one flat, searchable, un-tabbed list — not split across ribbon
tabs. Selecting an entry runs it **immediately** using
`createDefaultRecipe(ctx)` (generators) or each command field's resolved
default, where `getDefault(ctx)` takes precedence over `default`, against the
current selection, evaluated inline via the same
`evaluateGeneratorRecipe` path `generators.md`'s session already uses, just
invoked without opening the session UI around it. The recipe
`createDefaultRecipe` returns may be a single node or several — a compound
generator (e.g. a chord source feeding a voicing step) still evaluates and
commits in one inline pass, no different from a one-node case. No drawer
opens for the common case; the notes on the grid update and that's the whole
interaction.

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

## Delivery phases

This specification describes the intended direct-manipulation model in several
incremental phases. A feature is not required to implement later phases merely
because their behavior is documented here.

### Phase 1 — searchable immediate-application infrastructure

The first delivery establishes:

- a non-empty-selection entry point;
- one flat searchable operation list;
- resolution of command defaults or a generator's default recipe;
- generator bounds derived from the selection rectangle;
- one inline evaluation;
- immediate commit without opening a generator session;
- at most one history entry.

Phase 1 is conforming only for operations whose existing behavior already
satisfies the declared source, document-effect, result-selection, and outcome
policies. Operations without a valid selection-aware policy must be excluded
from Quick Apply until Phase 2 support exists. Establishing the palette and
inline execution path alone does not make every catalog generator a valid
selection transform.

### Phase 2 — reliable operation chaining

Adds:

- captured selection source material;
- explicit document-effect behavior;
- explicit result-selection behavior;
- no-change detection and diagnostics;
- operation-specific selection-aware generator recipes.

Completion criterion:

```text
Apply operation A
→ its intended result becomes the active selection
→ apply operation B
→ B consumes A's result
→ each operation is one undo step
```

### Phase 3 — semi-live tweak, then bake

Adds the temporary last-operation state described in
[Semi-live tweak, then bake](#semi-live-tweak-then-bake):

- the latest operation remains parametric;
- tweaks recompute from the original pre-operation snapshot;
- applying another operation or beginning another gesture bakes it;
- apply-to-bake creates one history entry rather than one entry per tweak.

This remains transient application state, not persistent document provenance.

### Phase 4 — on-canvas parameter affordances

Adds the Tier I and Tier II interaction surfaces described in
[Param affordance tiers](#param-affordance-tiers):

- draggable spatial bounds;
- Euclidean pattern overlays;
- scalar scrubbing;
- keyboard-equivalent parameter adjustment;
- accessible value announcements;
- an explicit **Open in generator session** escape hatch.

Tier III panels remain available only for parameters that cannot be expressed
clearly through direct manipulation.

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
