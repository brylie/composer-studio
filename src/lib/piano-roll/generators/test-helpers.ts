// Test-only fixtures for generator domain/evaluator/operator tests.

import { makeCommandContext } from '../commands/test-helpers.js';
import type { ChordEvent, ScaleEvent, TimeSignatureEvent } from '../timeline.js';
import type { Note } from '../types.js';
import { createGeneratorContext } from './context.js';
import { createSeededRandom, deriveSeed } from './random.js';
import type {
  GeneratedNoteDraft,
  GeneratorBounds,
  GeneratorContext,
  GeneratorOperatorDescriptor,
  NotePlan,
  PlanPort,
  VariationState,
} from './types.js';

export function makeBounds(overrides: Partial<GeneratorBounds> = {}): GeneratorBounds {
  return {
    time: { startBeat: 0, endBeat: 4 },
    pitch: { minMidi: 48, maxMidi: 84 },
    allowTail: false,
    ...overrides,
  };
}

export function makeVariation(overrides: Partial<VariationState> = {}): VariationState {
  return {
    seed: 1,
    generation: 0,
    locks: {
      rhythm: false,
      pitch: false,
      contour: false,
      register: false,
      voicing: false,
      dynamics: false,
    },
    ...overrides,
  };
}

export interface MakeGeneratorContextOptions {
  activeLayerId?: string;
  /** All document notes; `selectedIds` picks which of these become `ctx.notes`/the selection. */
  allNotes?: Note[];
  selectedIds?: Set<string>;
  chordTrack?: ChordEvent[];
  scaleTrack?: ScaleEvent[];
  timeSignatureTrack?: TimeSignatureEvent[];
  layerNotes?: Note[];
}

export function makeGeneratorContext(
  overrides: MakeGeneratorContextOptions = {},
): GeneratorContext {
  const allNotes = overrides.allNotes ?? [];
  const ctx = makeCommandContext(allNotes, overrides.selectedIds ?? new Set(), {
    activeLayerId: overrides.activeLayerId,
    chordTrack: overrides.chordTrack,
  });
  return createGeneratorContext(
    ctx,
    overrides.layerNotes ?? [],
    overrides.scaleTrack ?? [],
    overrides.timeSignatureTrack ?? [],
    overrides.activeLayerId,
  );
}

export function makeNoteDraft(
  overrides: Partial<GeneratedNoteDraft> & { eventKey: string },
): GeneratedNoteDraft {
  return {
    midiNote: 60,
    startBeat: 0,
    durationBeats: 1,
    velocity: 100,
    ...overrides,
  };
}

export function makeNotePlan(bounds: GeneratorBounds, notes: GeneratedNoteDraft[]): NotePlan {
  return { kind: 'notes', bounds, diagnostics: [], notes };
}

/** A source-role operator with no inputs, emitting a fixed NotePlan on its `out` port. */
export function makeSourceOperator(
  id: string,
  notes: GeneratedNoteDraft[],
  version = 1,
): GeneratorOperatorDescriptor {
  return {
    id,
    version,
    label: id,
    role: 'source',
    inputs: {},
    outputs: { out: { kind: 'notes' } },
    getDefaultParams: () => ({}),
    process: (_ctx, _inputs, request) => ({
      out: makeNotePlan(request.bounds, notes),
    }),
  };
}

/** A single-in/single-out 'notes' processor that transposes every note by `params.semitones`. */
export function makeTransposeOperator(id: string, version = 1): GeneratorOperatorDescriptor {
  return {
    id,
    version,
    label: id,
    role: 'processor',
    inputs: { in: { kind: 'notes' } },
    outputs: { out: { kind: 'notes' } },
    getDefaultParams: () => ({ semitones: 0 }),
    process: (_ctx, inputs, request) => {
      const plan = inputs.in as NotePlan;
      const semitones = Number(request.params.semitones ?? 0);
      return {
        out: makeNotePlan(
          request.bounds,
          plan.notes.map((n) => ({ ...n, midiNote: n.midiNote + semitones })),
        ),
      };
    },
  };
}

/** A merge-role operator that concatenates every note plan on its `multiple` input port. */
export function makeMergeOperator(id: string, version = 1): GeneratorOperatorDescriptor {
  return {
    id,
    version,
    label: id,
    role: 'merge',
    inputs: { in: { kind: 'notes', multiple: true } },
    outputs: { out: { kind: 'notes' } },
    getDefaultParams: () => ({}),
    process: (_ctx, inputs, request) => {
      const plans = Array.isArray(inputs.in) ? inputs.in : [inputs.in];
      const notes = plans.flatMap((plan) => (plan.kind === 'notes' ? plan.notes : []));
      return { out: makeNotePlan(request.bounds, notes) };
    },
  };
}

/** A source operator emitting an empty HarmonyPlan — pairs with makeHarmonyOnlyOperator. */
export function makeHarmonySourceOperator(id: string, version = 1): GeneratorOperatorDescriptor {
  return {
    id,
    version,
    label: id,
    role: 'source',
    inputs: {},
    outputs: { out: { kind: 'harmony' } },
    getDefaultParams: () => ({}),
    process: (_ctx, _inputs, request) => ({
      out: { kind: 'harmony', bounds: request.bounds, diagnostics: [], segments: [] },
    }),
  };
}

/** A processor declaring a 'harmony' input — incompatible with the 'notes' sources above, for negative tests. */
export function makeHarmonyOnlyOperator(id: string, version = 1): GeneratorOperatorDescriptor {
  return {
    id,
    version,
    label: id,
    role: 'processor',
    inputs: { in: { kind: 'harmony' } },
    outputs: { out: { kind: 'harmony' } },
    getDefaultParams: () => ({}),
    process: (_ctx, inputs, request) => ({
      out: { kind: 'harmony', bounds: request.bounds, diagnostics: [], segments: [] },
    }),
  };
}

/**
 * A source operator whose single note is randomized from
 * `request.variation.seed`, honoring `locks.pitch` the way a real pitch
 * operator would: `variation.seed` is already node-scoped and
 * generation-independent (the evaluator derives it that way), so combining
 * it with `generation` only when unlocked — and with a fixed `0` in place of
 * generation when locked — keeps a locked reroll stable across generations
 * while still varying by the session's actual seed.
 */
export function makeSeededPitchSourceOperator(
  id: string,
  version = 1,
): GeneratorOperatorDescriptor {
  return {
    id,
    version,
    label: id,
    role: 'source',
    inputs: {},
    outputs: { out: { kind: 'notes' } },
    getDefaultParams: () => ({}),
    process: (_ctx, _inputs, request) => {
      const pitchSeed = deriveSeed(
        request.variation.seed,
        request.variation.locks.pitch ? 0 : request.variation.generation,
        'pitch',
      );
      const random = createSeededRandom(pitchSeed);
      const midiNote = 60 + Math.floor(random() * 12);
      return {
        out: makeNotePlan(request.bounds, [
          makeNoteDraft({
            eventKey: `${request.nodeId}:0`,
            midiNote,
            startBeat: 0,
            durationBeats: 1,
          }),
        ]),
      };
    },
  };
}

/** A source operator emitting `count` identical, in-bounds notes — for note-count-limit tests. */
export function makeManyNotesSourceOperator(
  id: string,
  count: number,
  version = 1,
): GeneratorOperatorDescriptor {
  return {
    id,
    version,
    label: id,
    role: 'source',
    inputs: {},
    outputs: { out: { kind: 'notes' } },
    getDefaultParams: () => ({}),
    process: (_ctx, _inputs, request) => ({
      out: makeNotePlan(
        request.bounds,
        Array.from({ length: count }, (_, i) =>
          makeNoteDraft({
            eventKey: `${request.nodeId}:${String(i)}`,
            midiNote: 60,
            startBeat: 0,
            durationBeats: 1,
          }),
        ),
      ),
    }),
  };
}

/**
 * An operator with an arbitrary declared port shape and process()
 * implementation — for tests that need an operator to misbehave in a
 * specific way (return an undeclared port, the wrong plan kind, an array on
 * a non-multiple port, embed a diagnostic, embed invalid bounds, ...)
 * without a one-off named fixture per scenario.
 */
export function makeCustomOperator(
  id: string,
  outputs: Record<string, PlanPort>,
  process: GeneratorOperatorDescriptor['process'],
  opts: {
    inputs?: Record<string, PlanPort>;
    role?: GeneratorOperatorDescriptor['role'];
    version?: number;
  } = {},
): GeneratorOperatorDescriptor {
  return {
    id,
    version: opts.version ?? 1,
    label: id,
    role: opts.role ?? 'source',
    inputs: opts.inputs ?? {},
    outputs,
    getDefaultParams: () => ({}),
    process,
  };
}

export function makeOperatorMap(
  ...operators: GeneratorOperatorDescriptor[]
): ReadonlyMap<string, GeneratorOperatorDescriptor> {
  return new Map(operators.map((op) => [op.id, op]));
}
