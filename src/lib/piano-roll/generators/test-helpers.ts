// Test-only fixtures for generator domain/evaluator tests — not part of the
// real operator catalog (that lands in a later phase).

import { makeCommandContext } from '../commands/test-helpers.js';
import { createGeneratorContext } from './context.js';
import { createSeededRandom, deriveSeed } from './random.js';
import type {
  GeneratedNoteDraft,
  GeneratorBounds,
  GeneratorContext,
  GeneratorOperatorDescriptor,
  NotePlan,
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

export function makeGeneratorContext(overrides: { activeLayerId?: string } = {}): GeneratorContext {
  const ctx = makeCommandContext([], new Set(), { activeLayerId: overrides.activeLayerId });
  return createGeneratorContext(ctx, [], [], []);
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
 * operator would: locked rerolls reuse a fixed dimension sub-seed (ignoring
 * generation) instead of deriving a fresh one per generation.
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
      const pitchSeed = request.variation.locks.pitch
        ? 0
        : deriveSeed(request.variation.seed, request.variation.generation, 'pitch');
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

export function makeOperatorMap(
  ...operators: GeneratorOperatorDescriptor[]
): ReadonlyMap<string, GeneratorOperatorDescriptor> {
  return new Map(operators.map((op) => [op.id, op]));
}
