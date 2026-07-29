# Generators Specification

Status: draft

## 1. Purpose

Composer Studio should support generators as layer-bound, non-destructive composition sessions rather than one-shot random commands or permanently live project objects in V1. A generator occupies a bounded region of the musical grid, evaluates an ordered recipe of compatible modules, and produces live musical output that the user can preview, adjust, reroll, hear in context, and then commit as ordinary `Note[]` data on the target layer.

The first implementation should build on the existing command registry, `CommandContext`, timeline tracks, `Note` model, future layer model, and `src/lib/music-theory/` Tonal adapter. It may use a `MusicPlan` as an internal evaluation representation, but it must not replace ordinary notes as the editable result of applying or allow Tonal-specific structures to spread into UI or application state.

The generator system should be:

- **Genre-agnostic at its core.** Generators implement reusable structures such as pulse patterns, scale-degree contours, chord voicing, arpeggiation, repetition, and constrained variation.
- **Genre-aware through terminology and later presets.** Historically or stylistically named configurations should map to universal primitives rather than separate genre engines. Preset storage and browsing are deferred until the recipe and project models are established.
- **Live while editing.** The active generator session produces visible and audible notes on its target layer before the user commits them.
- **Ephemeral in V1.** Applying a generator persists ordinary notes, not a permanently live generator object. Persistent generator regions remain a later option once layers and project saving are mature.
- **Non-destructive while edited.** Parameter, module, bound, and reroll changes affect only a working session and become one undoable document mutation when the user chooses **Apply**.
- **Deterministic when seeded.** The same generator versions, context snapshot, bounds, parameters, and seed produce the same result.
- **Bounded and layer-scoped.** Every generator session targets one layer and operates inside explicit time and pitch limits.
- **Composable.** Rhythm, pitch, voicing, contour, register, and dynamics are reusable modules rather than duplicated logic.
- **Simple at first contact.** Advanced capability belongs inside recipes and progressive disclosure, not in growing collections of global buttons, nested tabs, collapsible panels, or modal dialogs.

### 1.1 UX principles

The interface should preserve a small and stable conceptual model even as the operator catalog grows:

1. **Place a region, shape its bounds, adjust its sound.** These are the primary actions.
2. **One inspector is the editing home.** Parameter editing, module order, diagnostics, reroll locks, and region actions live in one non-modal side inspector.
3. **The grid remains the composition surface.** Time, pitch, movement, resizing, layer placement, and audition remain visible in musical context.
4. **Progressive disclosure, not feature accumulation.** A recipe initially exposes a few useful macro controls and a compact module list. Only the selected module reveals detailed parameters.
5. **No nested navigation.** V1 should not use tabs inside tabs, accordions inside module cards, or modal dialogs launched from other modal dialogs.
6. **One clear primary action per state.** An active session uses **Apply** to commit its current notes and **Cancel** to discard them. There is no separate Bake action in V1 because Apply already converts the preview into ordinary notes.
7. **New capability should not add global chrome.** Adding an operator adds one catalog item and one inspector module type, not another permanent toolbar button or top-level panel.
8. **Direct manipulation and accessible controls are equivalent.** Every drag, resize, reorder, or drop action has a keyboard and menu alternative.

For the initial UI, a recipe should expose no more than roughly three to five primary controls before the user opens an individual module. Only one module should be expanded for detailed editing at a time.

## 2. Existing project basis

The current project already provides the main integration points:

```typescript
interface Note {
  id: string;
  midiNote: number;
  startBeat: number;
  durationBeats: number;
  velocity: number;
  layerId: string;
}

interface CommandContext extends SelectionContext {
  allNotes: Note[];
  playhead: number;
  chordTrack: ChordEvent[];
  activeLayerId: string;
}
```

The command registry already distinguishes `category: 'generate'`, uses pure domain-level command functions, and expects a complete replacement `Note[]` when a command is committed. The initial catalog already names these generators:

- `arpeggiate`
- `euclidean-rhythm`
- `motif-generate`
- `ostinato-generate`
- `generate-chords`

`generate-chords` is already implemented and establishes several useful precedents:

- a generator may read the chord track or derive material from a selection;
- generated notes are added without changing the source melody;
- chord symbols are converted to pitch-class sets through the music-theory adapter;
- voicing is constrained to an octave range;
- consecutive chords may use smooth voice leading.

The generator specification extends these patterns with a live layer-bound session, reusable bounds, deterministic variation, generator families, and a clear separation between preview state and committed notes.

## 3. Tonal.js responsibility boundary

Tonal.js should remain a music-theory engine. Composer Studio should remain responsible for time, interaction, randomness, note identity, preview state, collision policy, and document history.

Tonal.js is appropriate for:

- scale and chord lookup;
- note, interval, pitch-class, and MIDI conversion;
- scale-degree and chord-degree expansion;
- chord and scale detection;
- key and Roman-numeral relationships;
- progression conversion;
- chord voicing and voice-leading helpers;
- pitch ranges and collection operations where their behavior matches the app's needs.

Composer Studio should own:

- beat and bar bounds;
- time-signature-aware placement;
- density and rhythmic scheduling;
- seeded pseudo-randomness;
- parameter locking and constrained rerolling;
- preview lifecycle;
- note IDs;
- history and undo;
- overlap and replacement policy;
- performance limits;
- future preset presentation and storage.

The existing rule remains: no component or command imports `@tonaljs/*` directly. All Tonal usage stays inside `src/lib/music-theory/`, whose exported functions use Composer Studio types such as MIDI numbers, pitch classes, scale degrees, and plain arrays.

### 3.1 Tonal-first implementation rule

For every music-theory operation, implementation should first determine whether the Tonal.js ecosystem already provides the required primitive or a set of primitives that can be composed to produce it. A suitable Tonal primitive should be preferred over a bespoke implementation, even when Composer Studio needs a thin adapter or additional orchestration around it.

This applies especially to:

- note, MIDI, interval, and transposition arithmetic;
- pitch-class set operations;
- scale, mode, chord, and chord-type lookup;
- scale-degree, chord-degree, and Roman-numeral conversion;
- chord detection and progression conversion;
- pitch-range expansion and collection permutations;
- voicing dictionaries and voice-leading helpers;
- any other music-theory vocabulary or relationship represented by a maintained Tonal package.

Generator operators may compose several Tonal primitives with Composer Studio logic. The preference for Tonal does not mean that every generator must correspond to one Tonal function. Composer Studio still owns scheduling, bounded generation, seeded choice, constraint solving, context resolution, and the ordering of musical operations.

Bespoke music-theory logic is justified only when:

1. no suitable Tonal primitive exists;
2. the Tonal behavior cannot satisfy a documented Composer Studio requirement;
3. a measured performance issue requires a specialized implementation; or
4. the logic is fundamentally application-specific rather than a reusable music-theory primitive.

When bespoke theory logic is added, its implementation or tests should briefly document why Tonal was insufficient. It should remain behind `src/lib/music-theory/`, avoid duplicating Tonal lookup tables or vocabularies, and expose the same Composer Studio-owned data shapes as the rest of the adapter.

## 4. Core concepts

### 4.1 Generator family

A family groups generators by musical function, not by genre.

```typescript
type GeneratorFamily =
  | 'rhythm'
  | 'pitch'
  | 'motif'
  | 'arpeggio'
  | 'harmony'
  | 'voicing'
  | 'bass'
  | 'ostinato'
  | 'accompaniment';
```

A generator may belong to one primary family and carry secondary tags for discovery.

### 4.2 Presets are deferred

V1 should not introduce a preset storage model, preset browser, or preset migration policy. The immediate goal is a stable recipe, bounds, variation, and evaluation model.

A future preset can be represented as a named default `GeneratorRecipe` plus optional bounds and macro mappings. Deferring presets prevents speculative serialization work and does not constrain the generator engine. Genre-specific names may still appear in documentation and tests as examples of universal patterns.

### 4.3 Generator bounds

Every preview has visible time and pitch bounds.

```typescript
interface GeneratorBounds {
  time: {
    startBeat: number;
    endBeat: number;
  };
  pitch: {
    minMidi: number;
    maxMidi: number;
  };
  /** Authoritative policy for notes sustained beyond time.endBeat. */
  allowTail: boolean;
}
```

Rules:

- Bounds use canonical beats and MIDI numbers internally.
- The UI may display and edit time as beats or bars.
- Bar display is resolved through the time-signature track.
- Pitch bounds may be displayed as note names, octave numbers, piano-key rows, or a draggable vertical range.
- `startBeat < endBeat`.
- `minMidi <= maxMidi`.
- Pitch bounds are clamped to `[MIN_MIDI, MAX_MIDI]`.
- Generated note starts must lie inside the time bounds.
- Notes must end inside the time bounds unless `bounds.allowTail` is `true`.
- `bounds.allowTail` is the authoritative tail policy for session, evaluation-request, and operator-request validation. Validators and property tests must read it rather than infer permission from an operator type or parameter.
- Even when tails are allowed, note starts must remain inside the time bounds.
- A generator must not silently widen its bounds to make an algorithm succeed.

Bounds are shared generator chrome, not ordinary per-generator parameters. This keeps every generator consistent and allows the grid itself to edit bounds directly.

### 4.4 Note drafts

Generation should return notes without permanent IDs.

```typescript
type NoteDraft = Omit<Note, 'id' | 'layerId'>;

interface GeneratedNoteDraft extends NoteDraft {
  /** Stable within a session evaluation; used for keyed rendering and scheduling. */
  eventKey: string;
  role?: 'primary' | 'support' | 'bass' | 'voice' | 'accent';
  sourceStep?: number;
}
```

Permanent note IDs and `layerId` values are assigned only when output is committed. Live output uses deterministic `eventKey` values derived from the session, node, and event position and is rendered through `GeneratorSession.targetLayerId`, so repeated evaluations can be rendered and scheduled stably without becoming document notes.

### 4.5 Seeded variation

```typescript
interface VariationState {
  seed: number;
  generation: number;
  locks: {
    rhythm: boolean;
    pitch: boolean;
    contour: boolean;
    register: boolean;
    voicing: boolean;
    dynamics: boolean;
  };
}
```

The effective seed for each dimension is derived independently:

```typescript
const rhythmSeed = deriveSeed(seed, generation, 'rhythm');
const pitchSeed = deriveSeed(seed, generation, 'pitch');
const voicingSeed = deriveSeed(seed, generation, 'voicing');
```

When a dimension is locked, rerolling preserves its previous sub-seed or material. This lets a user keep a rhythm while rerolling pitches, keep a contour while changing register, or keep a voicing while rerolling dynamics.

The application should use a small, tested seeded pseudo-random number generator behind a local interface. Generator code must not call `Math.random()`.

### 4.6 Commit mode

The active session does not immediately merge notes into the layer's committed `Note[]`. When the user chooses **Apply**, the current evaluated result is converted to permanent notes using an explicit merge policy:

```typescript
type GeneratorCommitMode = 'insert' | 'replace-selection' | 'replace-bounds';
```

Defaults:

- `insert` is the safe default.
- `replace-selection` is offered only when the session has a valid captured source selection.
- `replace-bounds` is explicit and visually marks which committed notes will be removed.
- Applying affects only the target layer.
- Applying creates one document-history entry containing the final note mutation.
- Cancel creates no document mutation.

### 4.7 Layer-bound generator sessions

V1 uses one active, ephemeral generator session rather than persistent generator regions.

```typescript
interface GeneratorContextRevision {
  scaleTrackRevision?: number;
  chordTrackRevision?: number;
  sourceNotesRevision?: number;
  timeSignatureTrackRevision?: number;
}

interface GeneratorSession {
  id: string;
  targetLayerId: string;
  name: string;
  bounds: GeneratorBounds;
  recipe: GeneratorRecipe;
  variation: VariationState;
  commitMode: GeneratorCommitMode;
  source:
    | { kind: 'timeline-context' }
    | { kind: 'captured-notes'; notes: NoteDraft[] }
    | { kind: 'layer-range'; startBeat: number; endBeat: number };
  result: GeneratorResult | null;
  evaluationRevision: number;
  /** Context fingerprint used by the last successful evaluation. */
  evaluatedContextRevision: GeneratorContextRevision | null;
  status: 'ready' | 'stale' | 'evaluating' | 'error';
}
```

Rules:

- A session targets exactly one layer.
- Its evaluated notes are rendered and scheduled as live notes on that layer.
- Layer mute, solo, visibility, and volume apply to the preview output.
- The preview does not enter the layer's committed `Note[]` until Apply.
- Applying converts the current result to ordinary notes and closes the session.
- Cancel closes the session and discards its output.
- Selection-derived generators capture their source notes when the session starts. A transient UI selection must not become a dangling dependency.
- V1 sessions do not consume the output of another generator session. Composition happens inside one recipe.
- Only one active generator session is required in V1.
- Individual preview notes are not directly editable or pinnable in V1. After Apply, the resulting ordinary notes can be edited manually or processed by existing modifiers.

This model preserves the future option of persistent generator regions without requiring project serialization, virtual-note editing semantics, or dependency migration in the first milestone.

### 4.8 Music plan

Generators and transformations should not all write `NoteDraft[]` directly. A
small intermediate representation allows harmony, rhythm, pitch, voicing, and
event scheduling to be composed without implementing every useful combination
as a separate command.

```typescript
type MusicPlanKind = 'harmony' | 'rhythm' | 'pitch' | 'events' | 'notes';

interface MusicPlanBase {
  kind: MusicPlanKind;
  bounds: GeneratorBounds;
  diagnostics: GeneratorDiagnostic[];
}

interface HarmonyPlan extends MusicPlanBase {
  kind: 'harmony';
  segments: Array<{
    startBeat: number;
    endBeat: number;
    root: number;
    quality: string;
    pitchClasses: number[];
    function?: string;
  }>;
}

interface RhythmPlan extends MusicPlanBase {
  kind: 'rhythm';
  events: Array<{
    startBeat: number;
    durationBeats: number;
    accent: number;
  }>;
}

interface PitchPlan extends MusicPlanBase {
  kind: 'pitch';
  pitches: Array<{
    midiNote: number;
    degree?: number;
    sourceStep?: number;
    role?: string;
  }>;
}

interface EventPlan extends MusicPlanBase {
  kind: 'events';
  events: Array<{
    startBeat: number;
    durationBeats: number;
    pitches: number[];
    velocity: number;
    role?: string;
  }>;
}

interface NotePlan extends MusicPlanBase {
  kind: 'notes';
  notes: GeneratedNoteDraft[];
}

type MusicPlan = HarmonyPlan | RhythmPlan | PitchPlan | EventPlan | NotePlan;
```

The precise union may grow as real generators require it. The important rule is
that each plan kind has clear invariants and remains plain, serializable domain
data.

Typical flow:

```text
progression source
  -> harmonic transformation
  -> voicing
  -> arpeggiation
  -> Euclidean gate
  -> note renderer
```

A Euclidean algorithm can therefore be used in more than one role:

- as a rhythm source that supplies onsets to an arpeggio;
- as an event slicer or gate that filters an already-generated chord or note
  stream;
- as part of an accompaniment preset.

The implementation should share the Euclidean pulse algorithm while exposing
separate operator descriptors where the input and output contracts differ.

### 4.9 Operators, ports, and recipes

A user-facing generator may be one operator or a recipe containing several
operators.

```typescript
interface PlanPort {
  kind: MusicPlanKind;
  optional?: boolean;
  multiple?: boolean;
}

interface GeneratorOperatorDescriptor<
  TParams extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string;
  version: number;
  label: string;
  role: 'source' | 'processor' | 'realizer' | 'merge' | 'renderer';
  inputs: Record<string, PlanPort>;
  outputs: Record<string, PlanPort>;
  contextDependencies?: Array<
    'active-scale' | 'scale-track' | 'active-chord' | 'chord-track' | 'selection'
  >;
  getDefaultParams(ctx: GeneratorContext): TParams;
  process(
    ctx: GeneratorContext,
    inputs: Record<string, MusicPlan | MusicPlan[]>,
    request: OperatorRequest<TParams>,
  ): Record<string, MusicPlan | MusicPlan[]>;
}

interface GeneratorNodeInstance {
  id: string;
  operatorId: string;
  operatorVersion: number;
  params: Record<string, unknown>;
  enabled: boolean;
}

interface GeneratorEdge {
  from: { nodeId: string; port: string };
  to: { nodeId: string; port: string };
}

interface GeneratorRecipe {
  id: string;
  version: number;
  nodes: GeneratorNodeInstance[];
  edges: GeneratorEdge[];
  output: { nodeId: string; port: string };
}
```

Recipes are directed acyclic graphs. V1 must reject cycles. A serial chain is
the default presentation and data shape; parallel branches are represented by
explicit split/merge or parallel-container nodes rather than by arbitrary loose
wires.

### 4.10 Automatic wiring

The UX is semi-modular rather than a blank patching canvas. Users arrange
modules; Composer Studio creates and validates connections.

When a module is dropped after another module:

1. Find the previous module's primary compatible output.
2. Connect it to the new module's primary compatible input.
3. Fill optional context dependencies from the active scale, chord, selection,
   or timeline tracks without drawing those as ordinary signal wires.
4. If exactly one conversion is safe and lossless, insert a hidden or visible
   adapter node.
5. If there is no valid connection, reject the drop and explain which input is
   required.
6. If several materially different connections are possible, show a small
   chooser rather than guessing.

Context is not equivalent to a stream connection. For example, a chromatic
mediant processor consumes a `HarmonyPlan` and also declares an
`active-scale` dependency. The key context informs the transformation but does
not need to appear as a cable on every node.

### 4.11 Context-aware harmonic operators

Context-aware operators should expose musical relationships, not only absolute
pitch offsets.

Initial harmony processors may include:

- diatonic substitution;
- relative or parallel mode shift;
- secondary dominant;
- tritone substitution;
- chromatic mediant;
- Neo-Riemannian `P`, `L`, and `R` transformations;
- compound transformation sequences such as `PL`, `LR`, or a user-defined
  chain.

Example:

```typescript
interface ChromaticMediantParams {
  direction: 'up' | 'down';
  distance: 'major-third' | 'minor-third';
  qualityPolicy: 'preserve' | 'major' | 'minor' | 'nearest-common-tone';
  preferCommonTones: boolean;
}
```

The operator receives the current harmony and active key context, generates
candidate mediant-related chords, scores them against the selected policy, and
returns a new `HarmonyPlan`. It must not assume that only diatonic outcomes are
valid.

Compound Riemannian operations are recipes or repeated operator applications,
not special-case algorithms. This keeps the system open to other transformation
families and lets the same composition engine power both a simple inspector and
a later graphical rack editor.

## 5. Proposed generator API

The catalog entry, operator registry, recipe evaluator, and commit adapter have
separate responsibilities.

```typescript
interface GeneratorContext extends CommandContext {
  targetLayerId: string;
  layerNotes: Note[];
  scaleTrack: ScaleEvent[];
  timeSignatureTrack: TimeSignatureEvent[];
}

function createGeneratorContext(
  ctx: CommandContext,
  layerNotes: Note[],
  scaleTrack: ScaleEvent[],
  timeSignatureTrack: TimeSignatureEvent[],
): GeneratorContext {
  return {
    ...ctx,
    targetLayerId: ctx.activeLayerId,
    layerNotes,
    scaleTrack,
    timeSignatureTrack,
  };
}

interface OperatorRequest<TParams extends Record<string, unknown>> {
  bounds: GeneratorBounds;
  params: TParams;
  variation: VariationState;
  nodeId: string;
}

interface GeneratorEvaluationRequest {
  bounds: GeneratorBounds;
  recipe: GeneratorRecipe;
  variation: VariationState;
  contextRevision: GeneratorContextRevision;
  includeTrace?: boolean;
}

interface GeneratorDiagnostic {
  level: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  nodeId?: string;
  port?: string;
}

interface GeneratorResult {
  output: MusicPlan;
  notes: GeneratedNoteDraft[]; // populated by the final note renderer
  diagnostics: GeneratorDiagnostic[];
  trace?: Array<{
    nodeId: string;
    outputs: Record<string, MusicPlan | MusicPlan[]>;
  }>;
}

interface GeneratorDescriptor extends CommandDescriptorBase {
  version: number;
  category: 'generate';
  family: GeneratorFamily;
  tags?: string[];

  getDefaultBounds(ctx: GeneratorContext): GeneratorBounds;
  createDefaultRecipe(ctx: GeneratorContext): GeneratorRecipe;
}
```

`GeneratorDescriptor` is a generator browser and catalog entry that reuses command metadata for labels, icons, applicability, and discovery. It is not itself an executable `CommandDescriptor`, because it does not provide `run()` or `effect()`. A simple generator creates a one-node recipe plus a renderer. A compound starter generator creates a larger recipe. Future presets may create the same recipe shapes. Musical execution is delegated to the operator registry and evaluator:

```typescript
function evaluateGeneratorRecipe(
  ctx: GeneratorContext,
  request: GeneratorEvaluationRequest,
  operators: ReadonlyMap<string, GeneratorOperatorDescriptor>,
): GeneratorResult;
```

The evaluator:

1. validates node IDs, operator versions, ports, and edges;
2. rejects cycles;
3. topologically sorts the recipe;
4. derives a stable sub-seed for each node and variation dimension;
5. runs each operator exactly once per evaluation revision;
6. validates each output plan before passing it downstream;
7. returns the selected output and final rendered note drafts;
8. optionally returns a trace for tests and developer diagnostics.

Operator `process()` and recipe evaluation are pure. They do not:

- mutate application state;
- allocate permanent note IDs;
- record history;
- play audio;
- read the DOM;
- call browser randomness;
- import Svelte modules.

A small commit adapter converts an evaluated result into the current
whole-document command contract:

```typescript
function commitGeneratorResult(
  ctx: GeneratorContext,
  result: GeneratorResult,
  mode: GeneratorCommitMode,
  bounds: GeneratorBounds,
): { notes: Note[]; label: string } {
  const committed = result.notes.map((draft) => {
    const { eventKey: _eventKey, role: _role, sourceStep: _sourceStep, ...noteDraft } = draft;
    return clampNote({
      ...noteDraft,
      id: crypto.randomUUID(),
      layerId: ctx.targetLayerId,
    });
  });

  return {
    notes: mergeGeneratedNotes(ctx, committed, mode, bounds),
    label: 'Apply generator',
  };
}
```

Live preview and Apply use the same evaluator output. The application creates `GeneratorContext` by copying `CommandContext.activeLayerId` into `targetLayerId`, and the commit adapter assigns that target layer to every committed note. This preserves the existing registry and history architecture while enforcing the one-layer commit invariant and allowing the recipe to remain semi-modular and testable.

## 6. Generator session lifecycle

Generator state is application-session state, not document state in V1.

```typescript
interface VariationCheckpoint {
  seed: number;
  generation: number;
  randomizedParams?: Record<string, unknown>;
}

interface GeneratorSessionHistory {
  checkpoints: VariationCheckpoint[];
  index: number;
  limit: number;
}
```

The evaluated notes are derived data and are never stored in variation history. Navigating backward or forward restores the compact variation state and recomputes the result.

### 6.1 Creation and editing lifecycle

1. The user inserts or drags a generator onto a layer.
2. The application creates a `GeneratorSession` with default time and pitch bounds.
3. The recipe evaluator produces live preview notes that are visible and audible immediately.
4. Explicit user actions update the working session and trigger recomputation.
5. **Apply** records one document-history entry, commits the current result as ordinary notes on the target layer, and closes the session.
6. **Cancel** closes the session without changing the document.
7. After Apply, the notes behave exactly like manually entered notes and can be moved, resized, deleted, transformed, or selected normally.

The notes heard and seen immediately before Apply must match the committed notes exactly, apart from permanent IDs.

### 6.2 Manual recomputation

Recomputation is explicitly triggered rather than continuously reacting to every project change. It occurs when the user:

- changes an operator parameter;
- adds, removes, bypasses, or reorders a module;
- changes a bound, with pointer drags recomputing on release by default;
- clicks Reroll;
- clicks Recompute or Refresh after context has changed.

Changing a scale event, chord event, source note, or relevant time-signature event outside the session does not silently change the current preview. Instead, a declared context revision mismatch marks the session **stale** and offers **Recompute**. Playback continues using the last valid result until recomputation succeeds.

After a successful evaluation, application state stores the new `GeneratorResult`, increments `evaluationRevision`, copies `request.contextRevision` into `evaluatedContextRevision`, and sets the status to `ready`. A failed evaluation keeps the previous successful result and `evaluatedContextRevision` unchanged. Staleness compares the current revision only for context dependencies declared by the recipe against `evaluatedContextRevision`; unrelated track changes must not mark the session stale.

Continuous sliders may use a short debounce where performance permits, but the model remains event-triggered rather than reactive to transport movement or unrelated store updates.

### 6.3 Rendering and playback

Preview notes are live layer output:

- they are drawn in the piano roll inside the generator bounds;
- they are scheduled by the audio engine and heard during normal playback and looping;
- they obey target-layer mute, solo, visibility, volume, and instrument settings;
- they remain separate from committed notes until Apply;
- they use stable `eventKey` values for keyed rendering and scheduling;
- they are visually distinguishable while the session is open without relying on color alone.

Only one active session is required, so V1 does not need a global overlay for recalling saved generators. Closing the generator workspace means applying or cancelling the session.

### 6.4 Clean variation history

Rerolling must not flood document undo/redo with generated note snapshots.

- Reroll creates a session-local `VariationCheckpoint`.
- A checkpoint stores only `seed`, `generation`, and any parameters randomized by that reroll.
- Generated notes are recomputed from the checkpoint.
- Previous and Next Variation navigate this local history.
- The history may keep a bounded number such as 20 checkpoints.
- Apply creates one ordinary document-history entry for the final notes.
- Undo after Apply removes or restores the committed notes according to the existing document snapshot model; it does not reopen the generator session.

Dimension-level locks may remain in V1. Pinning or locking individual generated notes is a V2 feature because it requires stable event identity across structural changes and clearer rules for bounds, rhythm changes, and module reordering.

## 7. UX architecture

The generator interface should combine direct manipulation on the musical grid with a compact semi-modular recipe inspector. Sophisticated output should come from composable modules and strong defaults, not from exposing every possible setting at once.

### 7.1 Primary interaction model

Implement one bounded generator session on the piano roll with a single side inspector.

The active session region provides:

- horizontal handles for time bounds;
- vertical handles for pitch bounds;
- body drag for moving the complete region;
- layer ownership through the track or layer lane;
- a compact reroll affordance;
- clear selected, bypassed, warning, and error states.

The inspector provides, in one vertical surface:

1. generator name and primary Apply action;
2. three to five recipe macro controls where available;
3. bounds, layer, source, and context-staleness summary;
4. the ordered module chain;
5. detailed controls for the one selected module;
6. diagnostics and advanced seed/version information at the bottom.

The inspector is non-modal. It should not contain nested tabs. Module cards may collapse to a one-line summary, but only one module exposes detailed controls at a time.

### 7.2 Semi-modular recipe chain

The chain is automatically wired. Users arrange compatible modules; they do not manage routine cables.

A module card shows:

- name and family icon;
- bypass state;
- one-line musical summary, such as `5/8 pulses` or `Drop 2, C3-C5`;
- drag handle;
- duplicate, reset, and remove actions in a compact overflow menu;
- input/output compatibility feedback while dragging.

Dropping a module between two nodes rewires the chain automatically. Parallel processing requires an explicit parallel container, preventing the main workflow from becoming a freeform node graph.

```typescript
type ParallelMergePolicy = 'overlay' | 'alternate-events' | 'alternate-bars' | 'choose-one';
```

Arbitrary feedback, cross-branch patch cables, and continuous modulation routing are out of scope.

### 7.3 Progressive disclosure

A new generator starts in a compact state with musically useful defaults. Users should be able to place, resize, reroll, and accept a result without opening individual modules.

Deeper editing follows a single path:

```text
Generator session
  -> recipe summary and macros
  -> module list
  -> one selected module's parameters
```

There should be no separate basic, expert, generator, phrase, rhythm, and variation tabs. Advanced parameters use one optional disclosure at the end of the selected module, not another navigation hierarchy.

Future presets may map several low-level parameters to stable macro concepts such as density, motion, rhythmic activity, harmonic tension, or variation. Preset authoring and storage are outside V1; the underlying recipe should still permit explicit macro mappings later.

### 7.4 Generator browser and drop behavior

The generator browser may be opened from the ribbon, command palette, or inspector. V1 contains two item types:

- **Starter generators:** create a new session and default recipe.
- **Modules:** insert into the active session's chain.

Preset browsing is deferred.

Dropping a starter onto the piano roll creates a session:

- horizontal position determines `startBeat`;
- vertical position determines an initial register center;
- default duration and pitch span come from the descriptor;
- placement follows the current snap setting;
- the inspector opens without a modal dialog.

Dropping a module onto the session appends it. Dropping onto a visible insertion marker places it at that position. Incompatible drops are rejected with a short explanation and no recipe mutation.

### 7.5 Ribbon relationship

The ribbon remains a discovery and invocation surface. It should not become the editor for a composable recipe.

The ordinary **Generate** tab should contain a small family-level entry set such as Rhythm, Arpeggio, Harmony, Motif, and **Browse generators**. Choosing one starts a generator session or opens the browser. The ribbon must not expose every operator parameter or grow one permanent button per module.

While a session is active, a contextual **Generator** tab may expose session-level actions only:

- Open inspector
- Recompute
- Reroll
- Previous or next variation
- Bypass preview
- Apply
- Cancel

Detailed parameters and chain editing remain exclusively in the inspector.

Existing ribbon transformations continue to operate on committed note selections. A pipeline-capable algorithm may have both a note-command descriptor and a generator-operator descriptor backed by shared domain logic, but the same ribbon button must not silently change meaning based on selection. Adding a processor to a recipe happens through **Add module**, the browser, or drag-and-drop.

```text
Ribbon       = discover and start a generator session
Grid         = place and bound the active session
Inspector    = compose and edit its recipe
Layer system = supply ownership, playback, and committed-note destination
```

### 7.6 Recall and reuse are deferred

V1 does not persist the generator session after Apply. The result remains as ordinary notes, but the recipe is not automatically recallable from the project. This is a deliberate scope boundary, not a rejection of reusable generators.

Future options include:

- persistent layer-owned generator regions;
- a reusable recipe or preset library;
- attaching lightweight provenance to a generated note group;
- a **Repeat last generator** session command;
- saving a session as a reusable recipe once project and preset persistence exist.

The recipe and operator data model should remain serializable so these additions do not require redesigning the evaluator. V1 should not add persistence fields to `DocumentSnapshot` solely for generators.

### 7.7 Keyboard and non-drag workflow

Drag-and-drop cannot be required. Every workflow must also support:

- Insert at playhead
- Add module before or after from a searchable menu
- Keyboard module reordering
- Numeric start and end fields
- Beats or bars duration fields
- Minimum and maximum note fields
- Keyboard movement and resizing of bounds
- Command-palette invocation

### 7.8 Testable UX constraints

The following constraints are deliberate safeguards against incremental UI clutter:

- no modal is required for routine generator editing;
- no modal opens another modal;
- no nested tab sets in the generator inspector;
- only one module detail editor is open at a time;
- every module shares the same card shell and action placement;
- adding an operator does not require editing the ribbon layout;
- primary controls have stable semantic locators independent of visual order;
- drag-and-drop and keyboard insertion produce equivalent recipe data;
- hidden advanced controls do not affect output unless explicitly configured by the recipe.

## 8. Parameter model

Bounds, variation, and commit mode are shared controls. Operator-specific parameters remain in each operator descriptor, while a generator descriptor supplies the default recipe.

Common parameter concepts include:

```typescript
interface CommonMusicalParams {
  stepBeats?: number;
  noteCount?: number;
  density?: number;
  gate?: number;
  velocity?: number;
  velocityVariation?: number;
  maxLeapSemitones?: number;
  maxVoices?: number;
}
```

These are not required on every generator. They should use consistent names, units, and UI labels when present.

Useful shared policies:

```typescript
type PitchSource =
  'active-scale' | 'active-chord' | 'chord-track' | 'selection' | 'chromatic' | 'explicit';

type DurationPolicy = 'legato' | 'step' | 'fixed' | 'until-next-event';

type OverflowPolicy = 'truncate' | 'wrap' | 'reflect' | 'stop';
```

The current `ParamField` union can remain for ordinary controls. Generator-specific additions may later include `pattern-editor`, `pitch-class-set`, or `degree-sequence`, but these should be introduced only when an implemented generator needs them.

## 8.1 Composition examples

The following recipes should be representable without bespoke glue code.

### Arpeggio on a Euclidean rhythm

```text
Chord-track harmony source
  -> Smooth voicing
  -> Arpeggiate(up-down, two octaves)
  -> Euclidean gate(5 pulses, 8 steps, rotation 1)
  -> Render notes
```

### Euclidean chord slices

```text
Chord progression source
  -> Drop-2 voicing
  -> Chord event expansion
  -> Euclidean slicer(3 pulses, 8 steps)
  -> Gate length(80%)
  -> Render notes
```

### Key-aware chromatic mediant progression

```text
Diatonic progression source(active key)
  -> Chromatic mediant(direction up, preserve common tones)
  -> Cadence constraint
  -> Smooth voicing
  -> Render notes
```

### Parallel accompaniment

```text
Chord progression source
  -> Parallel container
       branch A: Root-fifth bass -> Euclidean gate
       branch B: Drop-2 voicing -> Offbeat rhythm
  -> Overlay merge
  -> Render notes
```

These examples are acceptance fixtures for the pipeline architecture. They need
not all ship in the first UI milestone, but the domain types should not make
them impossible.

## 9. Generator families and initial catalog

### 9.1 Rhythm family

Rhythm generators create onset and duration structures. They may repeat one pitch, distribute a source chord, or provide a rhythm plan to another generator.

#### `euclidean-rhythm`

Source:

- selected note or chord;
- explicit pitch;
- active chord;
- another motif in a later composition pipeline.

Core parameters:

```typescript
interface EuclideanRhythmParams {
  steps: number;
  pulses: number;
  rotation: number;
  stepBeats: number;
  durationPolicy: DurationPolicy;
  pitchDistribution: 'repeat' | 'cycle' | 'random';
}
```

The app may evaluate `@tonaljs/rhythm-pattern`, but the public adapter should expose the app's own boolean or onset representation.

#### `pulse-pattern`

A simpler deterministic family member for regular subdivisions, accents, rests, and probability-limited omissions. It is useful both on its own and as infrastructure for accompaniment presets.

### 9.2 Pitch family

Pitch generators choose notes within a scale, chord, pitch-class set, or chromatic range.

#### `scale-pattern`

Examples of degree patterns:

- ascending or descending;
- thirds;
- `1, 2, 3, 2`;
- sequence a cell through successive scale degrees;
- reflect at pitch bounds;
- constrained random walk.

Core parameters:

```typescript
interface ScalePatternParams {
  source: 'active-scale' | 'explicit-scale';
  root?: number;
  mode?: string;
  degrees: number[];
  stepBeats: number;
  direction: 'up' | 'down' | 'alternate' | 'random-walk';
  overflow: OverflowPolicy;
  maxLeapSemitones?: number;
}
```

Tonal adapter needs:

```typescript
notesInScaleRange(root, mode, minMidi, maxMidi): number[];
scaleDegreeAt(root, mode, degree, anchorMidi): number | null;
nearestScaleTone(root, mode, midi, direction): number | null;
```

### 9.3 Motif family

#### `motif-generate`

A motif combines rhythm, scale degrees or intervals, contour, and repetition behavior.

```typescript
interface MotifGenerateParams {
  source: 'active-scale' | 'selection-derived';
  lengthBeats: number;
  eventCount: number;
  contour: 'arch' | 'valley' | 'ascending' | 'descending' | 'mixed';
  maxLeapSemitones: number;
  repetition: number;
  variationAmount: number;
}
```

The generator should create a short coherent cell, not an unconstrained stream of random notes. At least one dimension should repeat or develop:

- rhythmic cell;
- interval cell;
- contour;
- anchor pitch;
- cadence tone.

#### `motif-sequence`

A related deterministic generator takes a selected motif and sequences it by scale degree, interval, or chord target. This may initially be classified as a transform if it replaces existing notes, or as a generator if it inserts repeated copies.

### 9.4 Arpeggio family

#### `arpeggiate`

Sources:

- selected simultaneous notes;
- selected chord-like pitch collection;
- active chord-track segment;
- explicit chord symbol.

```typescript
interface ArpeggiateParams {
  source: 'selection' | 'chord-track' | 'explicit-chord';
  pattern: 'up' | 'down' | 'up-down' | 'down-up' | 'outside-in' | 'inside-out' | 'random';
  stepBeats: number;
  octaveSpan: number;
  gate: number;
  restart: 'per-chord' | 'continuous';
}
```

Named genre or instrument presets may configure this generator, but the underlying patterns remain general.

### 9.5 Harmony family

#### `progression-generate`

This generator produces a `HarmonyPlan` during preview. Committing it as `ChordEvent[]` should be deferred until command history and document mutation support non-note tracks. Until then, a progression recipe may continue through voicing and rendering to commit sounding `Note[]`.

The harmonic engine should work with Roman-numeral or functional templates:

```typescript
interface ProgressionGenerateParams {
  keyRoot: number;
  mode: string;
  chordCount: number;
  harmonicRhythmBeats: number;
  vocabulary: string[];
  cadence: 'none' | 'half' | 'authentic' | 'plagal';
  repetitionAmount: number;
}
```

Tonal's key, progression, and Roman-numeral packages can resolve abstract harmonic symbols to chord names. Composer Studio should own progression grammars, weights, repetition rules, and genre presets.

### 9.6 Voicing family

#### `generate-chords`

This remains the first priority generator and should be migrated to the shared preview API.

Recommended additions:

```typescript
interface GenerateChordsParams {
  voiceCount: number;
  voicingStrategy: 'closed' | 'open' | 'drop2' | 'smooth-voice-leading';
  source: 'chord-track' | 'selection-derived';
  doublingPolicy: 'root-first' | 'balanced' | 'none';
  commonTonePreference: number;
  maxVoiceMovement: number;
}
```

Its existing `octaveRange` and `targetRange` become shared pitch and time bounds rather than command-specific parameters.

### 9.7 Bass family

#### `bass-line`

The bass generator follows chord segments while remaining within a low register.

```typescript
interface BassLineParams {
  source: 'chord-track' | 'selection-derived';
  pattern: 'root' | 'root-fifth' | 'pedal' | 'chord-tone-walk' | 'scale-approach';
  stepBeats: number;
  approachProbability: number;
  maxLeapSemitones: number;
  targetNextRoot: boolean;
}
```

“Walking bass” may be a preset combining chord-tone movement, stepwise approaches, quarter-note rhythm, and a target-next-root rule.

### 9.8 Ostinato family

#### `ostinato-generate`

Sources:

- selected motif;
- selected pitch set;
- active chord;
- generated scale cell.

```typescript
interface OstinatoGenerateParams {
  source: 'selection' | 'active-chord' | 'active-scale';
  patternLengthBeats: number;
  repeats: number;
  transposition: 'none' | 'follow-scale' | 'follow-chord-root';
  variationEvery: number;
  variationAmount: number;
}
```

This generator should preserve an identifiable repeating cell while allowing bounded changes at specified repetitions.

### 9.9 Accompaniment family

#### `accompaniment-pattern`

A general accompaniment engine combines chord segments, a rhythmic pattern, and a chord-tone ordering pattern.

```typescript
interface AccompanimentPatternParams {
  source: 'chord-track' | 'selection-derived';
  rhythm: number[];
  toneOrder: number[];
  voicing: 'fixed' | 'smooth';
  bassMode: 'none' | 'root' | 'lowest-voice';
  restart: 'per-chord' | 'continuous';
}
```

Possible presets:

| Preset label    | Universal configuration                            |
| --------------- | -------------------------------------------------- |
| Alberti bass    | Repeating low, high, middle, high chord-tone order |
| Oom-pah         | Bass onset followed by chord onset                 |
| Oom-pah-pah     | Bass onset followed by two chord onsets            |
| Offbeat stabs   | Chord events on selected offbeats                  |
| Broken tenths   | Alternating bass and upper chord tone              |
| Arpeggiated pad | Slow arpeggio with long gate and smooth voicing    |

The preset names may carry historical or genre associations. The implementation remains a combination of rhythm, chord-tone order, register, and voicing.

## 10. Constrained rerolling

The reroll control should change only the dimensions the user has left unlocked.

Examples:

- Lock rhythm, reroll pitches.
- Lock pitch, reroll rhythm.
- Lock contour, reroll starting register.
- Lock register, reroll contour.
- Lock voicing, reroll dynamics.

Pinning individual preview notes is a V2 milestone. V1 uses dimension-level locks because they are simpler to explain and test and do not require preserving note identity through rhythm changes, bounds changes, or module reordering.

The UI should show the seed and generation number in an advanced section, with a copyable recipe:

```json
{
  "generatorId": "motif-generate",
  "generatorVersion": 1,
  "seed": 481516,
  "generation": 7,
  "bounds": {
    "time": { "startBeat": 16, "endBeat": 20 },
    "pitch": { "minMidi": 60, "maxMidi": 76 },
    "allowTail": false
  }
}
```

This recipe snapshot is useful for bug reports, preset sharing, and deterministic reproduction. During the active session, the application retains the recipe, bounds, variation state, operator versions, and target layer. V1 does not persist that session into the project after Apply.

## 11. Generator versions

Determinism requires an algorithm version.

`GeneratorDescriptor.version` identifies the starter generator catalog entry, while each `GeneratorOperatorDescriptor.version` identifies the executable algorithm used by a recipe.

Changing musical behavior in a way that changes seeded output increments the relevant `version`. Tests may then preserve golden examples for each supported version.

Operator versions support deterministic tests, session checkpoints, bug reports, and a future persistence model. A breaking musical change increments the operator version. Migration support is required only when generator recipes become persisted or shared.

## 12. V1 persistence decision and feasibility analysis

V1 should use **ephemeral generator sessions with persistent committed notes**.

This is the recommended feasibility trade-off because the current project already has a stable `Note[]` mutation and history path, while persistent live generators would immediately require several additional systems:

- project serialization and migrations for recipes and operator versions;
- virtual-note selection and manual editing semantics;
- dependency invalidation when scales, chords, layers, or source notes change;
- lifecycle rules for mute, duplication, deletion, movement, overlap, and conversion to notes;
- conflict handling between committed and virtual notes;
- recovery behavior when an operator is missing or upgraded.

Those are worthwhile later, but they are not necessary to prove the generator UX or musical engine.

### 12.1 V1 document behavior

- `GeneratorSession` lives in application state only.
- `DocumentSnapshot` does not gain `generatorRegions` in V1.
- The target layer's committed notes remain unchanged during preview.
- Apply commits ordinary notes and creates one document-history entry.
- Cancel commits nothing.
- Project saving, when implemented, persists the resulting notes through the ordinary layer and note model.
- No recipe, seed, or generator object is required in the saved project for V1.

### 12.2 Context snapshots and staleness

Each evaluation request carries the current `GeneratorContextRevision`. On success, the application copies it to `GeneratorSession.evaluatedContextRevision`. When a dependency declared by the recipe no longer matches that stored revision, the session is marked stale. It does not silently recompute. The user may continue hearing the last valid result or click Recompute to evaluate against the current context.

### 12.3 Future persistent generators

Persistent generator regions should be reconsidered after the following foundations exist:

1. layers are implemented and serialized;
2. project saving and migration are implemented;
3. the ephemeral generator workflow has demonstrated that users need recall more than preset reuse or Repeat Last;
4. product tests clarify whether users expect generated notes to remain directly editable while still linked to a recipe.

The current `GeneratorRecipe`, operator versions, bounds, variation state, and layer targeting are intentionally serializable so a later `GeneratorRegion` can wrap them without changing the evaluator.

## 13. Music-theory adapter additions

Suggested adapter modules:

```text
src/lib/music-theory/
  index.ts
  pitch-range.ts
  scale-degrees.ts
  chord-detection.ts
  progression.ts
  voicing.ts
```

Suggested public functions:

```typescript
notesInPitchClassRange(
  pitchClasses: ReadonlySet<number>,
  minMidi: number,
  maxMidi: number,
): number[];

notesInScaleRange(
  root: number,
  mode: string,
  minMidi: number,
  maxMidi: number,
): number[];

scaleDegreeToMidi(
  root: number,
  mode: string,
  degree: number,
  anchorMidi: number,
): number | null;

detectChordCandidates(midiNotes: number[]): ChordCandidate[];

progressionFromRomanNumerals(
  tonic: number,
  numerals: string[],
): ChordSymbol[];

voiceChordSequence(
  segments: ChordPitchClassSegment[],
  bounds: GeneratorBounds['pitch'],
  options: VoiceSequenceOptions,
): number[][];
```

Likely Tonal packages to evaluate as generators are implemented:

- existing: `@tonaljs/note`, `@tonaljs/scale`, `@tonaljs/chord`, `@tonaljs/voice-leading`;
- near-term: `@tonaljs/interval`, `@tonaljs/chord-detect`, `@tonaljs/pcset`;
- harmony: `@tonaljs/key`, `@tonaljs/progression`, `@tonaljs/roman-numeral`;
- ranges and patterns: `@tonaljs/range`, `@tonaljs/collection`, `@tonaljs/rhythm-pattern`;
- advanced voicing: `@tonaljs/voicing`, `@tonaljs/voicing-dictionary`.

Packages should be added individually when a concrete adapter function needs them. The project should not adopt the full `tonal` bundle merely to make speculative APIs available.

## 14. Validation and safety limits

Every result must satisfy:

```typescript
function validateGeneratedResult(
  result: GeneratorResult,
  bounds: GeneratorBounds,
): GeneratorDiagnostic[];
```

Validation checks:

- all numeric values are finite;
- MIDI notes remain inside global and generator pitch bounds;
- starts remain inside time bounds;
- durations are at least `MIN_DURATION_BEATS`;
- velocities remain in `[1, 127]`;
- the result contains no duplicate notes with identical pitch, start, and duration unless the generator explicitly permits doubling;
- the output is sorted consistently;
- the note count remains below a preview limit;
- the generator does not mutate context arrays or parameter objects.

A shared maximum such as `MAX_GENERATED_NOTES` should prevent accidental UI freezes from tiny step sizes over long ranges. Exceeding the limit returns a diagnostic and no preview rather than silently truncating musical output.

## 15. Performance

Generation should usually be synchronous and fast enough for interactive preview.

Application-state behavior:

- recompute only after an explicit session action;
- recompute immediately for discrete parameter and module changes;
- debounce continuous slider input briefly where useful;
- recompute drag and resize changes on pointer release by default;
- mark context-dependent output stale rather than silently recomputing after unrelated document edits;
- cancel or ignore stale computations by session revision number;
- keep reroll history session-local and compact;
- record one document-history entry on Apply;
- do not schedule audio until the current result is valid.

If a future generator becomes expensive, the pure API can move behind a Web Worker without changing the descriptor or result shapes.

## 16. Accessibility

Generator UX must not depend on pointer precision or color perception.

Requirements:

- every draggable item has an equivalent insert action;
- all bounds are editable numerically;
- handles are keyboard focusable;
- reroll announces the new variation number;
- lock states have text labels and pressed states;
- preview notes differ from committed notes by outline or pattern, not color alone;
- errors and warnings are exposed in the parameter inspector and through assistive technology;
- Apply, Cancel, Reroll, and Recompute remain reachable without crossing the grid with a pointer.

## 17. Testing strategy

### Unit tests

Each generator and operator should test:

- declared input/output port compatibility;
- deterministic output for a fixed request;
- different output for an unlocked reroll where variation is expected;
- unchanged locked dimensions across rerolls;
- time and pitch bound compliance;
- empty or missing source behavior;
- scale and chord changes inside the bounds;
- minimum and maximum parameter values;
- no context mutation;
- stable ordering;
- diagnostics;
- bypass behavior;
- equivalent results when the same recipe is evaluated from a plain-data clone.

Pipeline compiler tests should cover topological ordering, automatic wiring,
missing required inputs, rejected cycles, parallel merges, and stable trace
output.

### Property tests

Good candidates:

- every generated note is valid after `clampNote`;
- output starts never exceed bounds, and note ends exceed the right bound only when `request.bounds.allowTail` is `true`;
- `pulses <= steps` for Euclidean rhythm;
- voice count never exceeds the requested count;
- scale-constrained generators emit only permitted pitch classes;
- repeated generation with the same request is deeply equal;
- every valid automatic connection joins compatible port kinds;
- reordering a chain never mutates the original recipe;
- disabled identity-capable processors preserve their input plan.

### Integration tests

- creating a generator session does not mutate the document;
- parameter changes update live preview notes without document-history entries;
- preview notes are scheduled during normal playback and obey target-layer mute and solo;
- reroll adds only a compact session checkpoint;
- Previous and Next Variation restore seed and randomized parameters and recompute equal output;
- Cancel discards the session without document mutation;
- Apply creates exactly one document-history entry containing the final note mutation;
- undo after Apply removes the committed notes and does not reopen the session;
- changing a declared chord, scale, source-note, or time-signature dependency marks the session stale without changing its current result;
- successful evaluation persists the request context revision, while failed evaluation preserves the last successful revision;
- Recompute updates a stale session against current context;
- `replace-bounds` previews and removes the correct committed notes on the target layer only;
- keyboard insertion and drag insertion create equivalent session data;
- dropping a compatible processor appends and wires it;
- dropping at an insertion marker uses the requested index;
- incompatible drops are rejected without recipe mutation;
- reordering or bypassing a node recomputes output without immediate history;
- a parallel container merges branches according to its policy.
- committed notes remain fully editable by existing piano-roll tools and transformations.

### E2E interaction tests

E2E tests should use stable semantic locators such as layer ID, session ID, recipe ID, node ID, operator ID, and insertion position. Avoid pixel-coordinate assertions except for a small number of pointer smoke tests. Most workflows should use accessible buttons and keyboard actions so failures identify application behavior rather than browser drag geometry.

Required scenarios:

- create a bounded generator session on a chosen layer;
- resize both time and pitch bounds;
- add Arpeggiate and Euclidean Gate in sequence;
- edit parameters and observe live-note changes and playback;
- reroll, lock one dimension, and verify the locked dimension remains stable;
- reorder two nodes and observe a deterministic change;
- bypass and re-enable a node;
- change a context dependency and verify that the session becomes stale;
- click Recompute and hear the updated result;
- Apply once and undo once;
- edit one of the committed notes manually;
- complete the same workflow without a pointer.

### Golden musical fixtures

Small human-readable fixtures should cover recognizable patterns:

- C major scale in thirds;
- a 3-pulse Euclidean pattern over 8 steps;
- C major Alberti ordering;
- ii-V-I voice leading inside a fixed register;
- a motif reroll with rhythm locked.

Golden tests should assert structural behavior, not claim artistic quality.

## 18. Implementation sequence

### Phase A: domain and evaluation infrastructure

1. Add `GeneratorBounds`, `MusicPlan`, operator ports, `GeneratorRecipe`, `GeneratedNoteDraft`, `VariationState`, `VariationCheckpoint`, and `GeneratorResult`.
2. Add recipe validation, automatic serial wiring, cycle rejection, and pipeline evaluation.
3. Add seeded randomness, stable `eventKey` derivation, and compact reroll checkpoints.
4. Add generator result validation and note-count limits.
5. Add operator versioning.

### Phase B: session, layer, and playback integration

1. Add one application-state `GeneratorSession` targeting a layer.
2. Render preview output on the piano roll without inserting it into committed `Note[]`.
3. Merge preview output into layer playback and honor mute, solo, visibility, volume, and instrument settings.
4. Add context revision fingerprints and stale-session diagnostics.
5. Add Apply and Cancel, with Apply using the existing whole-document note mutation and history path.

### Phase C: focused V1 UX

1. Add bounded session rendering and drag/resize behavior.
2. Add the single generator inspector with compact macros, ordered module cards, and one module detail editor.
3. Add insert, reorder, bypass, duplicate, reset, and remove module actions.
4. Add Recompute, Reroll, dimension locks, and Previous/Next Variation.
5. Add keyboard and numeric alternatives.
6. Add commit merge policies.
7. Add the small ribbon entry points and contextual Generator tab.

### Phase D: migrate known generators

1. Migrate `generate-chords` into harmony-source, voicing, and note-renderer operators.
2. Implement `arpeggiate`.
3. Implement `euclidean-rhythm` and Euclidean gate/slicer operators.
4. Implement `ostinato-generate`.
5. Implement `motif-generate`.

### Phase E: related genre-agnostic generators

1. Implement `scale-pattern`.
2. Implement `bass-line`.
3. Implement `accompaniment-pattern` without a preset persistence system.
4. Add motif sequencing.
5. Add more voicing and key-aware harmonic strategies.

### Phase F: deferred capabilities

1. Add individual-note pinning after stable event identity rules are proven.
2. Add reusable presets after project and library persistence exist.
3. Evaluate Repeat Last versus persistent generator regions using observed workflows.
4. If persistent regions are justified, add project serialization, migration, dependency invalidation, and a recall overlay.
5. Consider a dedicated rack editor for complex parallel recipes using the same recipe model.
6. Consider direct `HarmonyPlan` output to `ChordEvent[]`.

## 19. Acceptance criteria for the initial milestone

The initial generator milestone is complete when:

- a user can insert or drag one generator session onto a chosen layer;
- the session creates visible time and pitch bounds and a compact ordered recipe inspector;
- the default view exposes only a few primary controls and does not require nested tabs or modal dialogs;
- a user can add, reorder, bypass, duplicate, reset, and remove compatible modules;
- routine compatible drops are wired automatically;
- incompatible drops are rejected with an accessible explanation;
- moving or resizing bounds and changing parameters recomputes output through explicit user actions;
- generated notes are visible and audible in normal playback before Apply;
- preview output obeys the target layer's mute, solo, visibility, volume, and instrument settings;
- reroll stores only compact session variation checkpoints rather than note snapshots;
- Previous and Next Variation deterministically restore earlier results;
- changing a declared context dependency marks the session stale rather than silently recomputing;
- Recompute explicitly evaluates against current context;
- at least rhythm and pitch can be locked independently during rerolling;
- Apply commits ordinary notes as exactly one undoable document mutation and closes the session;
- Cancel creates no document mutation;
- live and committed notes match immediately before Apply;
- committed output can be manually edited and processed by existing transformations;
- `generate-chords` works through the new API;
- at least two additional generators use the same infrastructure;
- at least one recipe combines a pitch or harmony operator with a rhythm operator;
- generator code imports Tonal only through `src/lib/music-theory/`;
- each music-theory operator uses available Tonal primitives where possible, or documents why bespoke theory logic is required;
- no generator duplicates Tonal-provided theory vocabularies, interval tables, chord formulas, or pitch-class operations;
- all generated notes satisfy existing note invariants;
- adding a new operator does not require adding permanent ribbon chrome;
- the full workflow is keyboard-accessible and covered by E2E tests.

## 20. Resolved V1 decisions and deferred questions

### Resolved for V1

1. **History:** document undo/redo receives one Apply mutation. Rerolls use a bounded session-local history containing only seed, generation, and randomized parameter overrides.
2. **Note pinning:** individual generated-note pinning is deferred to V2. Dimension-level locks are sufficient for V1.
3. **Playback:** preview notes are visible and audible as live output on the target layer.
4. **Recomputation:** evaluation is manually triggered by explicit session actions. Context changes mark output stale and require Recompute.
5. **Presets:** preset storage, browsing, and project persistence are deferred. V1 focuses on the recipe and evaluator data model.
6. **Persistence:** the generator session is ephemeral. Apply persists ordinary, fully editable notes and closes the session.
7. **Layer scope:** every session targets one layer, and Apply mutates only that layer.

### Deferred questions

- Whether Repeat Last or a reusable recipe library is enough, or persistent generator regions are eventually needed.
- Whether persistent generators, if added, should coexist with directly editable linked notes or only virtual output.
- How individual-note pins survive rhythm changes, module reordering, changed bounds, or changed note counts.
- Whether a future dedicated rack view should be horizontal, vertical, or adaptive.
- How macros and presets are authored and validated once preset persistence is designed.
- Whether pipeline trace data is always retained during editing or enabled only in developer mode.

The recommended V1 is therefore a layer-bound, bounded, semi-modular generator session with live playback, explicit recomputation, deterministic reroll checkpoints, Apply/Cancel lifecycle, and ordinary notes as the only persistent musical result.
