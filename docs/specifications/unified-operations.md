# Unified Operations Specification

## Overview

[transformations.md](./transformations.md) and [generators.md](./generators.md)
grew as two parallel registries — `commandRegistry`/`CommandDescriptor` and
`generatorCatalog`/`GeneratorDescriptor` — with two parallel UI treatments:
the ribbon's `transform` tab opens a params drawer or applies instantly, its
`generate` tab always opens the full multi-node session/inspector, and
[direct-manipulation.md](./direct-manipulation.md)'s quick-apply palette is
currently the only surface that treats both as one thing.

That split is a real risk, not just an aesthetic one: if "transform" and
"generate" keep behaving differently for reasons that trace back to which
registry an entry happens to be declared in rather than what the entry
actually needs from the user, users build an intuition on one side that
doesn't transfer to the other — the "how do I exit Vim" failure mode, where
the modal boundary itself becomes the thing that's confusing, not either mode
alone. A generator is not a categorically different kind of thing from a
command; per this project's own framing, **a generator is a transform that
can also originate content when there's nothing to transform yet** (e.g.
selecting block chords and generating an arpeggio from that selection is a
transform of the selection; the same generator run over empty bounds is
origination). The UI should make that continuity legible instead of hiding it
behind two registries that happen to render differently.

This document doesn't propose merging the two execution engines — `run()`
and the recipe/DAG evaluator solve genuinely different problems and both
stay. What it unifies is the **discovery contract and interaction model**:
one shared shape every surface (ribbon, palette, quick-apply) queries
identically, and one rule — independent of registry — for whether invoking
an entry applies instantly, opens a drawer, or opens a session.

---

## What's already unified, and what isn't

`GeneratorDescriptor extends CommandDescriptorBase`
([generators.md types](../../src/lib/piano-roll/generators/types.ts)) — the
shared discovery fields (`id`, `category`, `labelKey`, `icon`, `isApplicable`,
`getDisabledReasonKey`) already exist as one contract, and
`QuickApplyPalette.svelte` already queries `commandRegistry` and
`generatorCatalog` through that shared shape into one flat, filterable list.
The contract-level unification this doc is scoped to has therefore already
happened once, in one place. What hasn't happened is carrying it through to
every other surface:

- **`RibbonPanel.svelte`'s two tabs behave differently by construction, not
  by decision.** The `transform` tab's `groupCommands()` path calls
  `onOpenCommand`, which opens the params drawer only if `command.params` is
  non-empty, otherwise applies directly. The `generate` tab's block
  unconditionally calls `onStartGenerator`, which always opens the full
  session/inspector — even for `euclidean-rhythm`, which quick-apply already
  proves runs correctly with zero drawer interaction. There is no code path
  today by which a generator button behaves like a one-click command button.
- **Metadata is duplicated in parallel, not shared.**
  [`command-metadata.ts`](../../src/lib/piano-roll/command-metadata.ts)
  declares `COMMAND_LABELS`/`COMMAND_DESCRIPTIONS` and
  `GENERATOR_LABELS`/`GENERATOR_DESCRIPTIONS` as two separate maps with
  identical shape and purpose, keyed by two different id spaces that happen
  not to collide only because command/generator ids are hand-checked for
  uniqueness (the `generate-chords` collision fixed elsewhere in this session
  is exactly the failure mode this duplication invites).
- **`getDisabledReasonKey` is inconsistently honored.** Commands' disabled
  tooltip resolves through `DISABLED_REASON_TEXT` via
  `command.getDisabledReasonKey?.(ctx)`
  (`RibbonPanel.svelte`). No `GeneratorDescriptor` in the catalog currently
  defines `getDisabledReasonKey`, and the ribbon's generate-tab block doesn't
  even consult it if one existed — the session-active tooltip
  (`'Apply or cancel the active generator session first'`) is a hardcoded
  string in the template instead of routed through the same field the
  command side already has.

None of this is a new type or field — `CommandDescriptorBase` already covers
it. The gap is application code special-casing `category === 'generate'` for
rendering decisions that should instead be driven by capability.

---

## The real dividing line: input dependency, not registry

Whether an operation needs a selection to act on is already answered per
descriptor by `isApplicable(ctx)`, but it's answered implicitly and
differently on each side — a command's `isApplicable` typically checks
`ctx.count > 0`, while every current `GeneratorDescriptor.isApplicable` in
the catalog is `() => true` (a generator can always originate content, even
with nothing selected). That's the correct behavior; it should also be a
**named, queryable capability** instead of something only inferable by
reading each descriptor's `isApplicable` body:

```typescript
type OperationInputMode =
  | 'requires-selection' // consumes a selection, produces transformed output (transpose, invert)
  | 'originates' // can run with nothing selected (pulse-pattern, euclidean-rhythm)
  | 'both' // transforms a selection if present, originates into bounds if not
  //         (generate-chords's chord-track source; an arpeggiate run against
  //         selected block chords vs. against an empty bounded region)
  | 'not-applicable'; // no selection semantics at all (export, view, transport)
```

Added to `CommandDescriptorBase` (not a new parallel field on
`GeneratorDescriptor` only), this makes the framing from this document's
Overview literal: a descriptor's `inputMode` says what it needs, not which
registry declared it. Today's commands are uniformly
`'requires-selection'`; today's generators are uniformly `'originates'` (none
in the catalog yet honor a selection as alternate input — that's exactly the
`'both'` case [direct-manipulation.md](./direct-manipulation.md#core-principle-the-selection-rectangle-is-the-bounds-field)
already assumes for bounds-from-selection, generalized to a first-class
value instead of an implicit assumption baked into `boundsFromSelectionOrDefault`).
`'not-applicable'` covers `category: 'export' | 'view' | 'transport'`
descriptors (`export-midi`, playback controls, zoom/scroll commands) that
have no selection-dependency story at all — making `inputMode` a required
field on every descriptor, rather than leaving those categories to omit it,
is what lets one resolver (below) answer "does this need a selection" for
the whole catalog without a null case.

---

## The real dividing line for UI weight: interaction tier, not registry

[direct-manipulation.md's param tiers](./direct-manipulation.md#param-affordance-tiers)
already define the right axis for "how much UI does invoking this need" —
tier I (spatial/selection bounds), tier II (scrub + keyboard), tier III
(panel). That axis should also decide whether the **session/inspector**
opens at all, which today it doesn't: the session only exists to compose or
recompute a _multi-node recipe_, not merely because an entry lives in
`generatorCatalog`. A single-node generator with only tier I/II params
(`euclidean-rhythm`, `pulse-pattern`) has no more need for the full session
UI on first invocation than `jitter` does for one.

Both halves of this axis need to be queryable metadata, not inferred at the
call site: `ParamField` gains an `interactionTier: 'spatial' | 'scrub' |
'panel'` field (the tier I/II/III classification above, stated per-field
instead of read off each param's shape by whoever's rendering it), and
`GeneratorDescriptor` (alongside `CommandDescriptor`) gains an `isComposable:
boolean` field. `isComposable` must be declared explicitly by each
descriptor, not derived from `GeneratorRecipe.nodes.length` — a compiled
recipe can contain renderer/adapter nodes that inflate the count for an
operator that is, musically, a single step (`euclidean-rhythm`'s recipe is
not "simple" merely because it happens to compile to one DAG node, and
`generate-chords`'s default recipe is not "composable" merely because
`chord-source → voicing` is two nodes). One resolver — consulted by the
ribbon, quick-apply palette, and command palette alike — reads
`interactionTier`/`isComposable` off the descriptor and is the single source
every surface queries for "does this apply instantly, open a drawer, or open
a session," rather than each surface re-deriving the answer from recipe
shape or param count on its own.

Concretely, two independent axes replace "click a command → drawer-or-instant,
click a generator → always session" — param tier resolves what the _primary_
click does, and composability only decides whether a _secondary_ affordance
exists alongside it. A composable descriptor's primary click is never routed
to the full session; the full session is reachable solely through the
secondary action:

| Condition                                                         | Primary click behavior                                                                                                                                          |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No params beyond tier I/II                                        | Apply instantly — the same `quickApplyCommand`/`quickApplyGenerator` path, invoked directly from the ribbon button, not routed through quick-apply's palette UI |
| Has tier III params, but is a single node (no recipe composition) | Open the params drawer — generator descriptors gain this path today only commands have                                                                          |

Separately, any descriptor with `isComposable: true` (e.g. `generate-chords`,
whose `chord-source → voicing` default recipe is itself only tier I/II — see
above) also gets a secondary "Compose…" affordance that opens the full
session/inspector, so it can be extended into a multi-node chain (starting
from Chords and adding Arpeggiate + Euclidean gate per
[generators.md §17](./generators.md#17-worked-example-composing-a-chain)).
This is additive, not a third branch of primary-click routing: the primary
click for a composable descriptor still resolves from the two rows above,
exactly as it would for a non-composable one. This precedence — param tier
decides the primary action, `isComposable` only ever adds the secondary one —
is what one shared resolver applies consistently across the ribbon, the
quick-apply palette, and the command palette.

This means the ribbon's `generate` tab stops being "buttons that always open
a session" and starts working exactly like `transform`'s: click applies,
unless there's a real reason not to. "Open in generator session" — already
named as the escape hatch in
[direct-manipulation.md's Relationship section](./direct-manipulation.md#relationship-to-the-full-generator-session) —
becomes that reason, surfaced as a secondary affordance per entry (mirroring
today's `Browse…` button), not the default interaction.

---

## Ribbon reorganization: group by musical intent, not descriptor kind

Once click behavior no longer depends on which registry an entry came from,
grouping by registry (`transform` tab vs `generate` tab) stops making sense
as the primary organizing structure either — it's the last remaining place
the two-registry split still shows up in the UI, now for no functional
reason. [ribbon.md](./ribbon.md#data-structure)'s `RibbonGroup.commandIds`
should resolve against **one merged id space** (commands and generators both
looked up by id, from one `Map` built over both registries) so a group can
mix both. Building that merged `Map` must explicitly detect any id present in
both `commandRegistry` and `generatorCatalog` and reject the merge (throw or
fail a startup assertion) rather than letting `new Map([...commands,
...generators])`-style construction silently keep whichever entry was
inserted last — the whole point of unifying the id space is to catch a
collision like `generate-chords` at declaration time instead of masking it
as last-write-wins. This duplicate-id check is orthogonal to collapsing
`COMMAND_LABELS`/`GENERATOR_LABELS` into one `OPERATION_LABELS` record (below):
the labels record stays a plain, unchecked `Record<string, string>` merge,
while the id space that resolves `RibbonGroup.commandIds` gets the explicit
validation. A focused test should cover a command and a generator declared
with the same id and assert the merge is rejected rather than silently
picking one:

```typescript
{
  id: 'harmony',
  labelKey: 'ribbon_group_harmony',
  // 'reharmonization' (command) and 'generate-chords' (generator) both
  // behave identically when clicked, per the table above — grouping them
  // by musical intent instead of by registry is what actually lets a
  // user's intuition transfer between them.
  commandIds: ['reharmonization', 'voice-leading-adapt', 'generate-chords'],
},
```

Whether this collapses `transform`/`generate` into a single tab, or keeps two
tabs but lets groups mix ids freely within each, is left open (see
Explicitly deferred) — the requirement is only that grouping stops being
registry-shaped.

---

## Shared metadata and disabled-reason plumbing

- Collapse `COMMAND_LABELS`/`GENERATOR_LABELS` into one `OPERATION_LABELS:
Record<string, string>` and likewise for descriptions, keyed across both
  registries' combined id space. This is metadata only, not an enforcement
  mechanism — per the Ribbon reorganization section above, `OPERATION_LABELS`
  stays a plain, unchecked `Record` merge. The actual collision detection
  (`generate-chords`, this session's actual bug) lives in the merged
  `commandRegistry`/`generatorCatalog` id-space `Map` built for
  `RibbonGroup.commandIds` resolution, which explicitly rejects a duplicate
  id rather than silently rendering two buttons with the same name in the
  same tab.
- Every `GeneratorDescriptor` in the catalog should declare
  `getDisabledReasonKey`, and `RibbonPanel.svelte`'s generate-tab block
  should resolve the session-active tooltip through it — via a generic key
  (e.g. `'generators.disabled.sessionActive'` alongside the existing
  `commands.disabled.*` keys in `DISABLED_REASON_TEXT`) — rather than a
  string literal duplicated in the template. Today the generate-tab's
  `disabled={sessionActive}` check and its tooltip are both computed straight
  from `store.generatorSession`, ahead of and independent of
  `isApplicable`/`getDisabledReasonKey` entirely — there's no ordering
  between them to fix so much as a missing wire. Two ways to close it, either
  is acceptable: fold "a session is already active" into
  `GeneratorDescriptor.isApplicable(ctx)` itself (so a disabled button is
  always an inapplicable one, matching how commands already work, and
  `getDisabledReasonKey` is the one thing consulted once `isApplicable` is
  false); or, since "session active" is a UI-level constraint rather than a
  property of `ctx` a generator can reason about, keep it out of
  `isApplicable` and instead give `GeneratorDescriptor` its own
  `getDisabledReasonKey`-shaped callback that `RibbonPanel.svelte` consults
  for the session-active case specifically. Either way, the tooltip text
  itself must come from that callback's key resolved through
  `DISABLED_REASON_TEXT`, not a template string literal — and existing
  command disabled-reason behavior (`command.getDisabledReasonKey?.(ctx)`)
  is unaffected either way.

---

## Worked example: euclidean-rhythm, before and after

**Today:** clicking "Euclidean" in the ribbon's Generate tab always opens the
full session/inspector — a bounded region appears on the grid, a module card
renders, and the user must find Apply. Clicking "Retrograde" in Transform
applies immediately. Same mental model ("run an operation"), different
number of steps, for reasons invisible to the user.

**After:** clicking "Euclidean" in the ribbon applies it instantly against
the current selection (or the playhead-relative default bounds if nothing's
selected) — identical in step count to clicking "Retrograde." `steps`,
`pulses`, and `rotation` stay reachable afterward as tier I/II on-canvas
quick-apply controls (per
[direct-manipulation.md's worked example](./direct-manipulation.md#worked-example-euclidean-rhythm)) —
no drawer, no session, for ordinary tuning. A secondary "Compose…" affordance
on the same entry remains for the case that actually needs the session:
chaining the Euclidean pattern through an additional processor as part of a
multi-node recipe. The default one-node recipe already existed
(`createDefaultRecipe`); this changes only which UI step is the default
landing spot.

---

## Non-goals

- **Not a data-model merge.** `CommandDescriptor.run()` and
  `GeneratorRecipe`/the DAG evaluator remain two separate mechanisms.
  Forcing every transform through the recipe evaluator (to get a "single
  node recipe" for free) or forcing every generator's default recipe through
  a synchronous `run()` (losing preview/recompute/variation) would be a much
  larger, riskier rewrite than what this document asks for, for no UX
  benefit — the user-facing inconsistency lives entirely in the application
  layer (ribbon rendering, metadata, click routing), not in these two
  domain-layer mechanisms coexisting.
- **Not a renaming of `category`.** `'transform' | 'generate' | 'export' |
'view' | 'transport'` stays as the descriptor's own taxonomy; `inputMode`
  (above) is an orthogonal, additive field, not a replacement — collapsing
  them would conflate "what kind of thing is this for catalog/palette
  filtering purposes" with "what does it need as input," which are
  independent questions (`export-midi` declares `inputMode: 'not-applicable'`
  rather than having no input-mode story at all).

---

## Explicitly deferred

- Whether the ribbon's `transform`/`generate` tabs collapse into one tab
  once grouping is by intent, or stay two tabs with intent-based groups
  inside each — a layout decision that doesn't block the click-behavior or
  metadata unification above, and is easier to judge once those land and the
  actual button counts per group are visible.
- The exact `OperationInputMode` naming and whether it's worth exposing in
  the command palette as a filter facet (e.g. "show only things that
  originate content") — not needed until the catalog is large enough that
  browsing, not searching, becomes the bottleneck.
- Migrating existing `getDefaultRecipe`-single-node generators' tier III
  params (e.g. `generate-chords`'s `source: 'chord-track' | 'selection-derived'`)
  into the params drawer is implementation work this spec motivates but
  doesn't sequence — it depends on whatever ships from
  [direct-manipulation.md](./direct-manipulation.md)'s own deferred tier-II
  scrub/keyboard work first, since a generator's drawer should only need to
  hold genuinely tier-III fields once that lands.
