# Unified Operations Specification

## Overview

[transformations.md](./transformations.md) and [generators.md](./generators.md)
grew as two parallel registries — `commandRegistry`/`CommandDescriptor` and
`generatorCatalog`/`GeneratorDescriptor` — with two parallel UI treatments.
The ribbon's Transform tab either applies a command immediately or opens a
parameter drawer, while the Generate tab opens the full generator
session/inspector. [direct-manipulation.md](./direct-manipulation.md) introduces
Quick Apply as the first surface that discovers commands and generators
together and invokes either execution engine from the same selection-driven
workflow.

That split is a real product risk, not merely an implementation detail. If
operations behave differently because of the registry in which they happen to
be declared, users must learn architectural boundaries that have no musical
meaning. A generator is not categorically separate from a transform: it may
transform selected material, originate new material, or support both depending
on context.

This document does **not** merge the execution engines:

- commands continue to use `CommandDescriptor.run()`;
- generators continue to use `GeneratorRecipe` and the DAG evaluator.

It unifies four things around those engines:

1. **discovery** — one validated operation identity space and shared metadata;
2. **meaning** — explicit input, source, document-effect, and result-selection
   semantics;
3. **interaction resolution** — one capability model for immediate execution,
   parameter surfaces, and composition;
4. **outcomes** — consistent applied, no-change, and failed behavior across
   every immediate-execution surface.

The core principle is:

> Registry determines the execution engine. Capability and context determine
> the user interaction.

---

## Relationship to direct-manipulation.md

[direct-manipulation.md](./direct-manipulation.md) is canonical for the
selection-driven behavior of Quick Apply, including:

- selection-derived spatial bounds;
- `QuickApplyBehavior`;
- captured source notes;
- document effects;
- result-selection policy;
- `QuickApplyOutcome`;
- semi-live tweak-and-bake behavior;
- Tier I, II, and III parameter affordances;
- delivery phases.

This document defines how those semantics are exposed consistently by the
combined command and generator catalog.

The two specifications divide responsibility as follows:

| Concern                                                              | Canonical specification  |
| -------------------------------------------------------------------- | ------------------------ |
| What Quick Apply means for selected notes                            | `direct-manipulation.md` |
| How commands and generators advertise that behavior                  | `unified-operations.md`  |
| Generator recipes, sessions, plans, evaluation, and commit mechanics | `generators.md`          |
| One-shot command execution                                           | `transformations.md`     |
| Selection construction and context                                   | `selection.md`           |
| Undo/redo and gesture history                                        | `command-history.md`     |

If this document and `direct-manipulation.md` disagree about selection source,
document effect, result selection, no-op handling, or Quick Apply history,
`direct-manipulation.md` takes precedence.

---

## What is already unified, and what is not

`GeneratorDescriptor` already shares discovery fields with command descriptors,
including identifiers, categories, labels, icons, applicability, and disabled
reasons. Quick Apply already projects `commandRegistry` and `generatorCatalog`
into one searchable list.

The remaining inconsistencies are structural:

- **Primary invocation is registry-shaped.** Commands can apply immediately or
  open a drawer; generators open a session regardless of what their parameters
  or recipe actually require.
- **Quick Apply eligibility is implicit.** A generator may be generally
  applicable but still have no meaningful selection-aware behavior.
- **Selection meaning is missing from the shared contract.** Bounds are derived
  from selection geometry, but source, replacement, and post-apply selection
  are not queryable.
- **Composability is inferred from implementation shape.** Recipe node count is
  not a reliable measure of whether users need a composition workflow.
- **Metadata is duplicated.** Labels and descriptions occupy separate command
  and generator maps.
- **Operation IDs are not validated as one namespace.** A command and generator
  can accidentally declare the same ID.
- **Disabled-state plumbing differs by surface.** Application constraints such
  as an already-active generator session are hard-coded rather than resolved
  consistently.
- **Immediate outcomes differ.** One surface may close silently on an empty
  generator result while another displays diagnostics or records a no-op
  history entry.

The unified operation model closes these gaps without requiring a common
execution engine.

---

## Four independent axes

An operation's interaction is resolved from four independent axes. No one axis
may be used as a substitute for another.

### 1. Input mode

`OperationInputMode` describes whether an operation can consume selected notes,
originate content, or has no note-input semantics.

```typescript
type OperationInputMode = 'requires-selection' | 'originates' | 'both' | 'not-applicable';
```

Meanings:

- `requires-selection` — the operation cannot produce a meaningful result
  without selected musical material, such as Transpose, Invert, or Retrograde.
- `originates` — the operation creates material from contextual or explicit
  bounds and does not consume selected notes as musical source.
- `both` — the operation can transform selected material when selection exists
  and can originate material through the full generator workflow when it does
  not.
- `not-applicable` — note-input semantics do not apply, such as export, view,
  transport, zoom, or other application commands.

`inputMode` is required on every operation descriptor so the catalog can answer
input questions without category checks or null cases.

`inputMode` does **not** define:

- whether selection supplies source or only bounds;
- whether selected notes are replaced or preserved;
- which notes are selected afterward;
- whether invocation is instant, drawer-based, or session-based.

Those belong to the remaining axes.

### 2. Quick Apply behavior

When a non-empty note selection exists, an operation is Quick Apply eligible
only if it resolves a complete
[`QuickApplyBehavior`](./direct-manipulation.md#selection-semantics-are-independent)
for the current context.

```typescript
interface QuickApplyBehavior {
  selectionRole: 'source' | 'source-and-bounds' | 'bounds-only';

  documentEffect: 'replace-selection' | 'insert-alongside-selection' | 'modify-selection';

  resultSelection: 'select-result' | 'preserve-source-selection' | 'select-source-and-result';
}
```

The descriptor contract exposes this through a resolver rather than assuming
one static behavior for every context:

```typescript
resolveQuickApplyBehavior(
  ctx: CommandContext,
): QuickApplyBehavior | null;
```

Returning `null` means:

- the operation is not a valid selection operation in the current context;
- it must not appear as an enabled Quick Apply entry;
- its general generator applicability may still allow a full session or
  content-origination workflow.

This distinction is essential:

> `inputMode: 'both'` means the operation is capable of both roles. It does not
> automatically prove that the current implementation has a correct
> selection-aware recipe or commit policy.

For generators, a valid Quick Apply behavior must be paired with an evaluation
path that actually honors it. For example, Arpeggiate over selected block
chords must configure or construct a recipe that consumes the captured selected
notes. Evaluating a chord-track recipe inside the same rectangle is not
equivalent.

### 3. Parameter interaction tier

Each parameter declares the lightest interaction surface that can express it
clearly and accessibly.

```typescript
type OperationInteractionTier = 'spatial' | 'scrub' | 'panel';

interface ParamField {
  // Existing parameter metadata...
  interactionTier: OperationInteractionTier;
}
```

These correspond to the tiers in
[direct-manipulation.md](./direct-manipulation.md#param-affordance-tiers):

- `spatial` — Tier I: expressed through time/pitch geometry or another
  on-canvas spatial affordance;
- `scrub` — Tier II: expressed through a compact on-canvas gesture with an
  equivalent keyboard action and accessible value announcement;
- `panel` — Tier III: requires a drawer or other focused parameter surface.

Parameter tier does not determine source semantics or composability. It only
describes the UI weight needed to choose or adjust a parameter.

For compound generator recipes, UI surfaces must not inspect recipe nodes
independently. A shared resolver derives the operation's effective interaction
profile from the recipe and its parameter metadata.

```typescript
interface ResolvedInteractionProfile {
  highestTier: OperationInteractionTier | null;
  spatialFields: ResolvedParamField[];
  scrubFields: ResolvedParamField[];
  panelFields: ResolvedParamField[];
}
```

The resolver is the only place that traverses command fields or generator
recipe/operator fields. Ribbon, palette, and inspector code consume the
resolved profile rather than reimplementing field classification.

### 4. Composability

Composability describes whether the operation is a useful entry point into the
full generator recipe workflow.

```typescript
interface CommandDescriptorBase {
  // Existing discovery fields...
  inputMode: OperationInputMode;
  isComposable: boolean;
}
```

`isComposable` must be declared explicitly. It must not be inferred from:

- descriptor category;
- the presence of generator machinery;
- `GeneratorRecipe.nodes.length`;
- the number of renderer or adapter nodes;
- whether the default recipe happens to be compound.

A musically simple operation may compile to several implementation nodes.
Conversely, a one-node realizer may still be a useful composition starting
point. `isComposable` describes the product affordance, not DAG shape.

Composability adds a secondary **Compose…** action. It does not force the
primary action to open a session.

---

## Shared operation contract

The combined contract may be represented directly on descriptors or through a
shared operation metadata record. The product requirements are equivalent
either way.

A representative shape is:

```typescript
interface UnifiedOperationDescriptor extends CommandDescriptorBase {
  inputMode: OperationInputMode;
  isComposable: boolean;

  /**
   * Returns the selection semantics for Quick Apply in the current context,
   * or null when the operation is not a valid Quick Apply operation.
   */
  resolveQuickApplyBehavior?(ctx: CommandContext): QuickApplyBehavior | null;
}
```

Commands and generators retain their engine-specific fields:

```typescript
interface CommandDescriptor extends UnifiedOperationDescriptor {
  params?: ParamField[];
  run(ctx: CommandContext, params: Record<string, unknown>): CommandResult;
}

interface GeneratorDescriptor extends UnifiedOperationDescriptor {
  getDefaultBounds(ctx: GeneratorContext): GeneratorBounds;
  createDefaultRecipe(ctx: GeneratorContext): GeneratorRecipe;

  // Narrows the inherited signature: a generator's Quick Apply behavior can
  // depend on scaleTrack, timeSignatureTrack, or targetLayerId (e.g. whether
  // Arpeggiate can build a selection-aware recipe against the current target
  // layer), none of which exist on the plain CommandContext the base
  // signature declares. GeneratorContext extends CommandContext, so this is
  // a safe narrowing, not a breaking one.
  resolveQuickApplyBehavior?(ctx: GeneratorContext): QuickApplyBehavior | null;
}
```

The exact TypeScript inheritance may differ to avoid coupling unrelated
contexts. What matters is that every surface can query the same resolved
capabilities without branching on command versus generator except when invoking
the underlying engine.

Correspondingly, the shared resolver must call each descriptor's
`resolveQuickApplyBehavior` with the context built for its own kind: a
`CommandDescriptor` gets `OperationResolutionContext.commandContext`, a
`GeneratorDescriptor` gets `OperationResolutionContext.generatorContext`. The
resolver never downgrades a generator's context to the plain `CommandContext`
shape — doing so would silently strip the fields its implementation may
depend on.

---

## Applicability, availability, and Quick Apply eligibility

These are separate concepts.

### Domain applicability

`isApplicable(ctx)` answers whether the operation has the musical or document
context required to run at all.

Examples:

- Transpose requires at least one selected note.
- A chord-track-only operation requires relevant chord-track context.
- Export MIDI may require at least one document note but no note selection.

`getDisabledReasonKey(ctx)` explains why domain applicability is false.

### Application availability

Application-level state may temporarily prevent invocation even when the
operation is musically applicable.

Examples:

- a generator session is already active;
- a blocking overlay or editing transaction is in progress;
- the target layer was removed;
- the current surface cannot support the required interaction.

These constraints belong to the shared resolver's UI/application context, not
necessarily to `CommandContext`.

```typescript
interface OperationResolutionContext {
  commandContext: CommandContext;
  generatorContext: GeneratorContext;
  hasActiveGeneratorSession: boolean;
  surface: OperationSurface;
}
```

Application constraints resolve through generic disabled-reason keys. UI
templates must not duplicate literal tooltip strings.

### Quick Apply eligibility

Quick Apply requires all of the following:

1. a non-empty note selection;
2. domain applicability;
3. application availability;
4. a non-null `resolveQuickApplyBehavior(ctx)` result;
5. a valid selection-aware execution path;
6. no active generator session that would violate the one-session invariant.

An operation may therefore be available in the generator browser or ribbon but
absent or disabled in Quick Apply.

---

## Shared resolver

Every operation-discovery surface uses one deterministic resolver.

```typescript
type OperationSurface = 'quick-apply' | 'ribbon' | 'command-palette' | 'generator-browser';

type OperationPrimaryAction =
  | 'quick-apply'
  | 'execute-immediately'
  | 'open-parameter-drawer'
  | 'open-generator-session'
  | 'disabled';

interface ResolvedOperation {
  id: string;
  label: string;
  description?: string;
  icon: string;
  category: string;

  enabled: boolean;
  disabledReasonKey?: string;

  inputMode: OperationInputMode;
  interaction: ResolvedInteractionProfile;
  quickApplyBehavior?: QuickApplyBehavior;

  primaryAction: OperationPrimaryAction;
  secondaryActions: Array<'compose'>;
}
```

The resolver:

1. validates operation identity and metadata;
2. checks domain applicability;
3. checks application-level constraints;
4. resolves Quick Apply behavior when selection exists;
5. resolves the effective interaction profile;
6. reads explicit composability;
7. applies the invocation policy for the requesting surface;
8. returns labels and disabled reasons without requiring the surface to inspect
   registry type or recipe structure.

Surfaces may present the resolved result differently, but they must not
reinterpret source, document effect, result selection, availability, or
outcome semantics.

---

## Surface invocation policies

Shared semantics do not mean every surface must use the same primary click.
Each surface has an explicit purpose.

### Quick Apply palette

Quick Apply is the deliberate instant-default path.

When an operation is Quick Apply eligible:

- it executes immediately using resolved command defaults or the generator's
  selection-aware default recipe;
- no parameter drawer opens;
- no generator session opens;
- Tier III fields use their resolved defaults for this invocation;
- the operation returns the canonical immediate outcome;
- a successful result applies its declared document and selection effects.

This fast path is intentional. Parameter tiers influence other surfaces and
later tweak affordances; they do not turn the Quick Apply palette into another
form browser.

A Quick Apply entry must be absent or disabled when no valid
`QuickApplyBehavior` exists.

### Ribbon

The ribbon is the primary browsable operation surface. Its primary action uses
the resolved interaction profile:

| Context                                                                        | Primary ribbon action                                                                                                              |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Note selection exists, valid Quick Apply behavior, no Tier III fields          | Quick Apply immediately                                                                                                            |
| Note selection exists, valid Quick Apply behavior, one or more Tier III fields | Open parameter drawer, then execute with the same Quick Apply semantics                                                            |
| Note selection exists, but no valid Quick Apply behavior                       | Do not present as a selection transform; open the generator session only when the operation supports a meaningful session workflow |
| No selection, `inputMode: 'requires-selection'`                                | Disabled                                                                                                                           |
| No selection, `inputMode: 'originates'` or `'both'`                            | Open the full generator session and place or derive bounds according to `generators.md`                                            |
| `inputMode: 'not-applicable'`                                                  | Execute or open parameters according to the ordinary command contract                                                              |

The current canonical policy reserves Quick Apply for non-empty selection.
No-selection generation is therefore not called Quick Apply.

A future **instant origination** path may be specified separately, but it must
define its own bounds, commit, selection, history, and outcome semantics before
being added. Until then, no-selection generators use the full session workflow.

### Command palette

The command palette uses the same resolved operation data but may expose more
than one explicit action:

- **Apply** — Quick Apply when eligible;
- **Configure…** — open a Tier III parameter surface;
- **Compose…** — open a generator session when `isComposable` is true.

Keyboard interaction must make the chosen action explicit rather than silently
changing behavior based on registry type.

### Generator browser

The generator browser remains the discovery surface for origination and
composition. It may start a session even when the same operation supports Quick
Apply over selected notes.

Its cards should use the same labels, descriptions, availability reasons, and
composability metadata as other surfaces.

---

## Resolved defaults

Immediate command execution uses each parameter field's resolved default:

```typescript
const value = field.getDefault ? field.getDefault(ctx) : field.default;
```

Generator execution uses `GeneratorDescriptor.createDefaultRecipe(ctx)`.
Compound recipes are supported; Quick Apply must not assume a one-node recipe.

For selection-aware generators, the descriptor or shared resolver must produce a
recipe that honors the resolved `QuickApplyBehavior`. Acceptable approaches
include:

- a selection-specific recipe factory;
- deterministic source-parameter overrides;
- an input plan constructed from captured selected notes.

The selected notes are captured at invocation time, before evaluation. Live UI
selection must not remain a dangling dependency.

---

## Context-resolved structural parameters

A structural parameter does not always require the user to answer a question
when context already supplies an unambiguous default.

`generate-chords` is the canonical example:

```typescript
source: 'chord-track' | 'selection-derived';
```

The source is structurally important, but the ordinary primary path can resolve
it from context:

- with a valid note selection, default to `selection-derived`;
- without a selection and with chord-track context, default to `chord-track`;
- when both are available and the user invokes Quick Apply, selection-derived
  wins because Quick Apply is explicitly selection-driven;
- the parameter drawer or generator session may expose an override.

This avoids a false choice in the common path while preserving explicit control.

The same pattern may apply to other source selectors, but it must be documented
per operation. Context resolution must never silently substitute unrelated
musical material.

---

## Canonical selection behaviors

The following defaults align the unified catalog with
`direct-manipulation.md`.

| Operation                                      | Input mode         | Quick Apply selection role | Document effect            | Result selection          | Composable |
| ---------------------------------------------- | ------------------ | -------------------------- | -------------------------- | ------------------------- | ---------- |
| Transpose                                      | requires-selection | source                     | modify-selection           | select-result             | false      |
| Retrograde                                     | requires-selection | source                     | modify-selection           | select-result             | false      |
| Arpeggiate selected chords                     | both               | source-and-bounds          | replace-selection          | select-result             | true       |
| Generate chords beneath a melody               | both               | source-and-bounds          | insert-alongside-selection | preserve-source-selection | true       |
| Euclidean rhythm inside selected bounds        | originates         | bounds-only                | insert-alongside-selection | select-result             | true       |
| Ostinato from selected motif                   | both               | source-and-bounds          | replace-selection          | select-result             | true       |
| Motif from active scale inside selected bounds | originates         | bounds-only                | insert-alongside-selection | select-result             | true       |
| Export MIDI                                    | not-applicable     | —                          | —                          | —                         | false      |

These are product defaults, not universal laws for every future preset. A
distinct operation or named preset may declare different semantics when its
label and description make that difference clear.

---

## Immediate outcomes

Every immediate-execution surface uses the canonical outcome semantics from
[direct-manipulation.md](./direct-manipulation.md#quick-apply-outcomes-and-history).

```typescript
type QuickApplyOutcome =
  | {
      status: 'applied';
      resultNoteIds: string[];
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

The same outcome rules apply whether the engine was a command or generator.

### Applied

In immediate-commit phases:

- document notes change;
- exactly one history entry is recorded;
- document effect is applied;
- result selection is applied using `resultNoteIds`;
- the invoking surface closes or returns to the piano roll;
- the result is announced accessibly.

### No change

A no-change outcome:

- records no history;
- changes no selection;
- keeps the current operation surface open;
- displays a concrete explanation.

Examples:

- no chord is active in the selected range;
- the generated plan is valid but empty;
- resolved defaults produce an identical note document.

A no-op history entry is never used as evidence that execution occurred.

### Failed

A failed outcome:

- mutates neither notes nor history;
- preserves the user's search query and highlighted operation;
- presents the most relevant operation-neutral diagnostic;
- allows correction, configuration, or transition to Compose where appropriate.

Generator diagnostics are adapted to `OperationDiagnostic` at the application
boundary rather than exposed as a generator-only UI contract.

### Semi-live phase

When the semi-live phase from `direct-manipulation.md` is implemented,
successful evaluation updates transient live-operation state rather than
recording history immediately. The same source, document-effect,
result-selection, no-change, and failure semantics remain in force; history is
recorded once at bake.

---

## Composability and Compose

Every operation with `isComposable: true` receives a secondary **Compose…**
action wherever the surface has room to expose it.

Compose:

- creates a normal generator session;
- starts from the same resolved recipe and context as the ordinary invocation;
- carries captured source notes when the operation is selection-aware;
- preserves the operation's initial bounds;
- allows module insertion, rerolling, variation locks, preview, Apply, and
  Cancel according to `generators.md`.

Compose is an escape hatch into structural editing. It is not a correction for
an operation whose Quick Apply behavior is undefined or incorrect.

The primary action remains determined by the requesting surface and interaction
profile. `isComposable` only adds the secondary path.

---

## One validated operation identity space

Commands and generators remain in separate engine registries, but discovery
uses one validated ID namespace.

```typescript
function mergeOperationRegistries(
  commands: CommandDescriptor[],
  generators: GeneratorDescriptor[],
): Map<string, UnifiedOperationDescriptor> {
  // Reject duplicates before constructing the result.
}
```

The merge must explicitly reject any ID present in both registries. It must not
use last-write-wins behavior.

A focused test must declare a command and generator with the same ID and assert
that registry construction fails.

The combined registry is used for:

- ribbon group resolution;
- command-palette search;
- Quick Apply discovery;
- shared metadata validation;
- operation lookup by ID.

Execution still dispatches to the command runner or generator evaluator based
on the resolved descriptor's engine type.

---

## Shared metadata

Labels and descriptions share one operation namespace:

```typescript
const OPERATION_LABELS: Record<string, string> = {};
const OPERATION_DESCRIPTIONS: Record<string, string> = {};
```

These records are display metadata, not collision enforcement. Duplicate ID
validation belongs to the combined registry builder.

Every registered operation must have:

- a label;
- a concise description;
- an icon;
- searchable tags where useful;
- an input mode;
- an explicit composability value;
- interaction-tier metadata for every parameter;
- a disabled reason when unavailable;
- a Quick Apply behavior resolver when selection-driven invocation is
  supported.

Missing metadata should fail a development-time catalog validation rather than
degrade silently to divergent UI strings.

---

## Disabled-reason plumbing

Disabled reasons are resolved through keys and one shared text catalog.

```typescript
interface OperationAvailability {
  enabled: boolean;
  reasonKey?: string;
}
```

The resolver combines:

- descriptor applicability;
- operation input mode;
- current selection;
- Quick Apply eligibility;
- active generator-session state;
- surface capabilities;
- target-layer validity;
- other application constraints.

UI templates render the resolved reason. They do not hard-code strings such as
“Apply or cancel the active generator session first.”

Command behavior remains compatible with existing
`getDisabledReasonKey(ctx)`. Generator and application-level reasons are
adapted into the same resolved availability model.

---

## Ribbon reorganization: musical intent, not engine type

Once invocation no longer depends on registry type, ribbon grouping should not
be registry-shaped.

`RibbonGroup.commandIds` may be renamed to `operationIds` and resolved through
the combined validated operation map.

```typescript
{
  id: 'harmony',
  labelKey: 'ribbon_group_harmony',
  operationIds: [
    'reharmonization',
    'voice-leading-adapt',
    'generate-chords',
  ],
}
```

Groups may mix commands and generators when they share musical intent.

Whether Transform and Generate collapse into one tab is a separate layout
decision. The invariant is that:

- groups resolve through one operation namespace;
- interaction is capability-driven;
- engine type is not exposed as an arbitrary modal boundary.

---

## Worked examples

### Arpeggiate selected chords

Context:

- selected simultaneous or chord-like notes;
- no chord-track marker required.

Resolution:

```text
inputMode: both
QuickApplyBehavior:
  selectionRole: source-and-bounds
  documentEffect: replace-selection
  resultSelection: select-result
isComposable: true
```

Quick Apply:

1. captures the selected notes;
2. derives bounds from their extent;
3. creates or overrides the recipe to use selection-derived harmony;
4. evaluates inline;
5. replaces the captured notes;
6. selects the committed arpeggio;
7. returns one applied outcome and one undo entry.

Compose starts the same recipe in a full session.

### Generate chords beneath a melody

Context:

- selected melody notes.

Resolution:

```text
inputMode: both
QuickApplyBehavior:
  selectionRole: source-and-bounds
  documentEffect: insert-alongside-selection
  resultSelection: preserve-source-selection
isComposable: true
```

The source selector resolves to selection-derived. Chord notes are inserted
beside the melody, while the melody remains selected.

Without selected notes, the generator may start a session using chord-track
context. That no-selection workflow is not Quick Apply.

### Euclidean rhythm

With selection:

```text
inputMode: originates
QuickApplyBehavior:
  selectionRole: bounds-only
  documentEffect: insert-alongside-selection
  resultSelection: select-result
isComposable: true
```

The selection rectangle supplies bounds but not musical source. Quick Apply
inserts the default Euclidean result and selects it.

Phase-specific behavior:

- initial phases: immediate default execution;
- semi-live phase: latest result remains tweakable until bake;
- on-canvas phase: steps, pulses, rotation, and gate use the Euclidean overlay
  and accessible keyboard equivalents;
- Compose: opens the recipe session for chaining processors.

With no selection, the current canonical policy opens the full generator
session rather than calling the action Quick Apply.

### Generate Chords source resolution

With selection:

```text
source = selection-derived
```

Without selection but with chord-track context:

```text
source = chord-track
```

The source parameter remains available as an override in the parameter drawer
or session. Context resolution removes an unnecessary question from the common
path without removing control.

---

## Surface consistency rules

All operation surfaces must share:

- operation identity;
- labels and descriptions;
- domain applicability;
- application availability;
- disabled reasons;
- Quick Apply behavior;
- resolved defaults;
- captured source semantics;
- document effect;
- result selection;
- no-change detection;
- diagnostics;
- history behavior;
- accessible announcements.

Surfaces may differ intentionally in:

- whether defaults execute immediately;
- whether Tier III fields open a drawer;
- whether Compose is shown inline or as a secondary menu action;
- layout and search presentation.

Those differences are explicit surface policies. They must not emerge from
`category === 'generate'` checks or separate metadata maps.

---

## Delivery phases

This work should follow the phases in
[direct-manipulation.md](./direct-manipulation.md#delivery-phases).

### Phase 1 — unified discovery and immediate infrastructure

- validate one operation ID namespace;
- share labels, descriptions, and disabled reasons;
- add `OperationInputMode`;
- add explicit `isComposable`;
- add parameter interaction tiers;
- create the shared resolver;
- expose only operations whose current execution already satisfies their
  declared Quick Apply behavior;
- preserve command and generator engines.

Phase 1 does not make every generator a valid selection transform merely by
deriving its bounds from selection geometry.

### Phase 2 — reliable selection semantics and chaining

- implement `resolveQuickApplyBehavior`;
- capture source notes;
- add selection-aware generator recipes or source overrides;
- implement document effects;
- implement result-selection policies;
- implement applied/no-change/failed outcomes;
- prevent no-op history entries;
- add cross-surface behavior tests.

Completion criterion:

```text
Apply operation A
→ A's intended result becomes the active selection
→ apply operation B
→ B consumes A's result
→ each immediate operation is one undo step
```

### Phase 3 — semi-live tweak and bake

- preserve one transient latest-operation state;
- recompute tweaks from the original snapshot;
- use resolved interaction metadata for tweak controls;
- record one history entry at bake;
- keep the unified outcome and selection semantics.

### Phase 4 — on-canvas affordances and complete surface routing

- implement Tier I and Tier II controls;
- add keyboard-equivalent actions and announcements;
- route ribbon primary actions from resolved interaction profiles;
- add Compose secondary actions;
- reorganize ribbon groups around musical intent;
- keep Tier III fields in focused parameter surfaces.

### Future phase — optional instant origination

Instant no-selection execution is explicitly outside the current Quick Apply
contract.

Before adding it, define:

- how bounds are chosen or placed;
- whether output is committed immediately or previewed;
- result selection;
- no-change and failure behavior;
- history semantics;
- how it differs visibly from starting a generator session.

It must be named and specified separately rather than silently broadening Quick
Apply.

---

## Acceptance criteria

The unified operation system is conforming when:

1. a command and generator cannot register the same ID;
2. all operation surfaces resolve labels and disabled reasons from shared
   metadata;
3. no surface decides behavior solely from command versus generator registry;
4. Quick Apply lists only operations with valid behavior for the current
   selection;
5. Arpeggiate over selected chords consumes captured selected notes;
6. Generate Chords over selected melody defaults to selection-derived source;
7. selected-note replacement and insertion policies are operation-specific;
8. successful chaining targets the previous operation's intended result;
9. valid empty output creates no history entry and displays a no-change
   explanation;
10. evaluation failure mutates neither document nor history and exposes a
    diagnostic;
11. the ribbon opens a drawer only when its resolved surface policy requires
    Tier III input;
12. composable operations expose Compose as a secondary action;
13. no-selection generation opens a generator session under the current
    canonical policy;
14. command and generator immediate execution produce the same outcome shape;
15. keyboard and assistive-technology behavior does not depend on engine type.

---

## Non-goals

- **No execution-engine merge.** Commands remain commands; generators remain
  recipe evaluations.
- **No category removal.** Transform, Generate, Export, View, and Transport
  remain useful taxonomy. Category does not determine invocation behavior.
- **No persistent operation provenance.** Semi-live state remains transient
  according to `direct-manipulation.md`.
- **No recipe-node-count heuristics.** DAG implementation shape does not define
  interaction tier or composability.
- **No silent instant origination.** No-selection immediate generation requires
  a separate future contract.
- **No requirement that every surface have identical layout.** The shared
  contract governs meaning and outcomes; surface policy governs presentation.

---

## Explicitly deferred

- Whether Transform and Generate become one ribbon tab or remain separate tabs
  containing mixed musical-intent groups.
- The exact public TypeScript inheritance between command, generator, and
  unified discovery descriptors.
- Whether `resolveQuickApplyBehavior` lives directly on descriptors or in a
  central operation metadata catalog.
- The exact `OperationDiagnostic` representation.
- Command-palette facets for input mode, composability, or musical family.
- Optional instant origination without a selection.
- Preset-specific overrides of canonical selection behavior.
- Migration of every existing parameter to Tier I, II, or III metadata.
