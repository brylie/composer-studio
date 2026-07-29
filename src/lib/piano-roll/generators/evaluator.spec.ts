import { describe, expect, it } from 'vitest';
import { evaluateGeneratorRecipe } from './evaluator.js';
import {
  makeBounds,
  makeCustomOperator,
  makeGeneratorContext,
  makeHarmonyOnlyOperator,
  makeHarmonySourceOperator,
  makeManyNotesSourceOperator,
  makeMergeOperator,
  makeNoteDraft,
  makeNotePlan,
  makeOperatorMap,
  makeSeededPitchSourceOperator,
  makeSourceOperator,
  makeTransposeOperator,
  makeVariation,
} from './test-helpers.js';
import type { GeneratorEvaluationRequest, GeneratorRecipe } from './types.js';

const node = (
  id: string,
  operatorId: string,
  params: Record<string, unknown> = {},
  enabled = true,
) => ({
  id,
  operatorId,
  operatorVersion: 1,
  params,
  enabled,
});

const contextRevision = {};

function makeRequest(
  recipe: GeneratorRecipe,
  overrides: Partial<Omit<GeneratorEvaluationRequest, 'recipe'>> = {},
): GeneratorEvaluationRequest {
  return {
    bounds: makeBounds(),
    variation: makeVariation(),
    contextRevision,
    ...overrides,
    recipe,
  };
}

describe('evaluateGeneratorRecipe', () => {
  const ctx = makeGeneratorContext();

  it('renders a single source node through to notes', () => {
    const notes = [makeNoteDraft({ eventKey: 'a', midiNote: 60, startBeat: 0 })];
    const operators = makeOperatorMap(makeSourceOperator('source', notes));
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'source')],
      edges: [],
      output: { nodeId: 'a', port: 'out' },
    };
    const result = evaluateGeneratorRecipe(ctx, makeRequest(recipe), operators);
    expect(result.diagnostics).toEqual([]);
    expect(result.notes).toEqual(notes);
    expect(result.output.kind).toBe('notes');
  });

  it('runs a serial chain source -> processor', () => {
    const notes = [makeNoteDraft({ eventKey: 'a', midiNote: 60, startBeat: 0 })];
    const operators = makeOperatorMap(
      makeSourceOperator('source', notes),
      makeTransposeOperator('transpose'),
    );
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'source'), node('b', 'transpose', { semitones: 12 })],
      edges: [{ from: { nodeId: 'a', port: 'out' }, to: { nodeId: 'b', port: 'in' } }],
      output: { nodeId: 'b', port: 'out' },
    };
    const result = evaluateGeneratorRecipe(ctx, makeRequest(recipe), operators);
    expect(result.notes).toEqual([expect.objectContaining({ midiNote: 72 })]);
  });

  it('merges two source branches through a merge node', () => {
    const operators = makeOperatorMap(
      makeSourceOperator('source-a', [
        makeNoteDraft({ eventKey: 'a', midiNote: 60, startBeat: 0 }),
      ]),
      makeSourceOperator('source-b', [
        makeNoteDraft({ eventKey: 'b', midiNote: 64, startBeat: 1 }),
      ]),
      makeMergeOperator('merge'),
    );
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'source-a'), node('b', 'source-b'), node('c', 'merge')],
      edges: [
        { from: { nodeId: 'a', port: 'out' }, to: { nodeId: 'c', port: 'in' } },
        { from: { nodeId: 'b', port: 'out' }, to: { nodeId: 'c', port: 'in' } },
      ],
      output: { nodeId: 'c', port: 'out' },
    };
    const result = evaluateGeneratorRecipe(ctx, makeRequest(recipe), operators);
    expect(result.notes.map((n) => n.midiNote).sort()).toEqual([60, 64]);
  });

  it('is deterministic for a fixed request', () => {
    const operators = makeOperatorMap(makeSeededPitchSourceOperator('source'));
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'source')],
      edges: [],
      output: { nodeId: 'a', port: 'out' },
    };
    const request = makeRequest(recipe, { variation: makeVariation({ seed: 7, generation: 3 }) });
    const first = evaluateGeneratorRecipe(ctx, request, operators);
    const second = evaluateGeneratorRecipe(ctx, request, operators);
    expect(first).toEqual(second);
  });

  it('produces different output across an unlocked reroll (generation bump)', () => {
    const operators = makeOperatorMap(makeSeededPitchSourceOperator('source'));
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'source')],
      edges: [],
      output: { nodeId: 'a', port: 'out' },
    };
    const results = Array.from(
      { length: 8 },
      (_, generation) =>
        evaluateGeneratorRecipe(
          ctx,
          makeRequest(recipe, { variation: makeVariation({ seed: 7, generation }) }),
          operators,
        ).notes[0].midiNote,
    );
    expect(new Set(results).size).toBeGreaterThan(1);
  });

  it('keeps a locked dimension stable across rerolls, but still varies by the session seed', () => {
    const operators = makeOperatorMap(makeSeededPitchSourceOperator('source'));
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'source')],
      edges: [],
      output: { nodeId: 'a', port: 'out' },
    };
    const lockedPitchesFor = (seed: number) =>
      Array.from({ length: 5 }, (_, generation) => {
        const locked = makeVariation({
          seed,
          generation,
          locks: { ...makeVariation().locks, pitch: true },
        });
        return evaluateGeneratorRecipe(ctx, makeRequest(recipe, { variation: locked }), operators)
          .notes[0].midiNote;
      });

    // Stable across generations for each fixed seed...
    const lockedPitchPerSeed = Array.from({ length: 8 }, (_, seed) => {
      const pitches = lockedPitchesFor(seed);
      expect(new Set(pitches).size).toBe(1);
      return pitches[0];
    });
    // ...but not pinned to one hardcoded value regardless of the session's
    // actual seed (a single pair could coincidentally collide on the same
    // pitch out of only 12 possibilities, so this checks a spread of seeds).
    expect(new Set(lockedPitchPerSeed).size).toBeGreaterThan(1);
  });

  it('honors time and pitch bounds compliance diagnostics without discarding valid notes', () => {
    const outOfBounds = [makeNoteDraft({ eventKey: 'a', midiNote: 200, startBeat: 0 })];
    const operators = makeOperatorMap(makeSourceOperator('source', outOfBounds));
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'source')],
      edges: [],
      output: { nodeId: 'a', port: 'out' },
    };
    const result = evaluateGeneratorRecipe(ctx, makeRequest(recipe), operators);
    expect(result.diagnostics.map((d) => d.code)).toContain('midi-out-of-bounds');
    expect(result.notes).toEqual(outOfBounds); // still returned — only the note-count limit clears the preview
  });

  it('drops the preview and reports a diagnostic when the note-count limit is exceeded', () => {
    const operators = makeOperatorMap(makeManyNotesSourceOperator('source', 2001));
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'source')],
      edges: [],
      output: { nodeId: 'a', port: 'out' },
    };
    const result = evaluateGeneratorRecipe(ctx, makeRequest(recipe), operators);
    expect(result.diagnostics.map((d) => d.code)).toContain('max-notes-exceeded');
    expect(result.notes).toEqual([]);
    // The returned plan must agree with the top-level notes — a caller
    // reading result.output.notes shouldn't see the dropped preview reappear.
    expect(result.output.kind).toBe('notes');
    expect(result.output.kind === 'notes' && result.output.notes).toEqual([]);
  });

  it('returns error diagnostics and an empty result for a cyclic recipe, without throwing', () => {
    const operators = makeOperatorMap(makeTransposeOperator('transpose'));
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'transpose'), node('b', 'transpose')],
      edges: [
        { from: { nodeId: 'a', port: 'out' }, to: { nodeId: 'b', port: 'in' } },
        { from: { nodeId: 'b', port: 'out' }, to: { nodeId: 'a', port: 'in' } },
      ],
      output: { nodeId: 'a', port: 'out' },
    };
    const result = evaluateGeneratorRecipe(ctx, makeRequest(recipe), operators);
    expect(result.diagnostics.map((d) => d.code)).toContain('cycle-detected');
    expect(result.notes).toEqual([]);
  });

  it('returns an empty result for missing/invalid required-input wiring instead of throwing', () => {
    const operators = makeOperatorMap(makeTransposeOperator('transpose'));
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'transpose')],
      edges: [],
      output: { nodeId: 'a', port: 'out' },
    };
    const result = evaluateGeneratorRecipe(ctx, makeRequest(recipe), operators);
    expect(result.diagnostics.map((d) => d.code)).toContain('missing-required-input');
    expect(result.notes).toEqual([]);
  });

  it('flags a recipe output that does not resolve to a note plan', () => {
    const operators = makeOperatorMap(
      makeHarmonySourceOperator('source'),
      makeHarmonyOnlyOperator('harmony'),
    );
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'source'), node('b', 'harmony')],
      edges: [{ from: { nodeId: 'a', port: 'out' }, to: { nodeId: 'b', port: 'in' } }],
      output: { nodeId: 'b', port: 'out' },
    };
    const result = evaluateGeneratorRecipe(ctx, makeRequest(recipe), operators);
    expect(result.diagnostics.map((d) => d.code)).toContain('output-not-notes');
    expect(result.notes).toEqual([]);
  });

  it('bypasses a disabled identity-capable node, preserving its input plan unchanged', () => {
    const notes = [makeNoteDraft({ eventKey: 'a', midiNote: 60, startBeat: 0 })];
    const operators = makeOperatorMap(
      makeSourceOperator('source', notes),
      makeTransposeOperator('transpose'),
    );
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'source'), node('b', 'transpose', { semitones: 12 }, false)],
      edges: [{ from: { nodeId: 'a', port: 'out' }, to: { nodeId: 'b', port: 'in' } }],
      output: { nodeId: 'b', port: 'out' },
    };
    const result = evaluateGeneratorRecipe(ctx, makeRequest(recipe), operators);
    expect(result.notes).toEqual(notes); // unchanged — the +12 semitone transform never ran
  });

  it('does not mutate the context it is given', () => {
    const operators = makeOperatorMap(makeSourceOperator('source', []));
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'source')],
      edges: [],
      output: { nodeId: 'a', port: 'out' },
    };
    const before = structuredClone(ctx);
    evaluateGeneratorRecipe(ctx, makeRequest(recipe), operators);
    expect(ctx).toEqual(before);
  });

  it('produces the same result when evaluated from a plain-data clone of ctx/request', () => {
    const notes = [makeNoteDraft({ eventKey: 'a', midiNote: 60, startBeat: 0 })];
    const operators = makeOperatorMap(makeSourceOperator('source', notes));
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'source')],
      edges: [],
      output: { nodeId: 'a', port: 'out' },
    };
    const request = makeRequest(recipe);
    const original = evaluateGeneratorRecipe(ctx, request, operators);
    const cloned = evaluateGeneratorRecipe(
      structuredClone(ctx),
      structuredClone(request),
      operators,
    );
    expect(cloned).toEqual(original);
  });

  it('returns a stable trace in topological order when includeTrace is set', () => {
    const operators = makeOperatorMap(
      makeSourceOperator('source', [makeNoteDraft({ eventKey: 'a', midiNote: 60, startBeat: 0 })]),
      makeTransposeOperator('transpose'),
    );
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'source'), node('b', 'transpose')],
      edges: [{ from: { nodeId: 'a', port: 'out' }, to: { nodeId: 'b', port: 'in' } }],
      output: { nodeId: 'b', port: 'out' },
    };
    const request = makeRequest(recipe, { includeTrace: true });
    const first = evaluateGeneratorRecipe(ctx, request, operators);
    const second = evaluateGeneratorRecipe(ctx, request, operators);
    expect(first.trace?.map((t) => t.nodeId)).toEqual(['a', 'b']);
    expect(first.trace).toEqual(second.trace);
  });
});

describe('evaluateGeneratorRecipe — bounds validation', () => {
  const ctx = makeGeneratorContext();
  const trivialRecipe: GeneratorRecipe = {
    id: 'r',
    version: 1,
    nodes: [node('a', 'source')],
    edges: [],
    output: { nodeId: 'a', port: 'out' },
  };
  const operators = makeOperatorMap(
    makeSourceOperator('source', [makeNoteDraft({ eventKey: 'a', midiNote: 60, startBeat: 0 })]),
  );

  it('rejects reversed time bounds without running the recipe', () => {
    const bounds = makeBounds({ time: { startBeat: 4, endBeat: 0 } });
    const result = evaluateGeneratorRecipe(ctx, makeRequest(trivialRecipe, { bounds }), operators);
    expect(result.diagnostics.map((d) => d.code)).toContain('bounds-time-reversed');
    expect(result.notes).toEqual([]);
  });

  it('rejects equal time endpoints (startBeat must be strictly less than endBeat)', () => {
    const bounds = makeBounds({ time: { startBeat: 2, endBeat: 2 } });
    const result = evaluateGeneratorRecipe(ctx, makeRequest(trivialRecipe, { bounds }), operators);
    expect(result.diagnostics.map((d) => d.code)).toContain('bounds-time-reversed');
    expect(result.notes).toEqual([]);
  });

  it('rejects non-finite bounds values', () => {
    const bounds = makeBounds({ time: { startBeat: 0, endBeat: Infinity } });
    const result = evaluateGeneratorRecipe(ctx, makeRequest(trivialRecipe, { bounds }), operators);
    expect(result.diagnostics.map((d) => d.code)).toContain('bounds-non-finite');
    expect(result.notes).toEqual([]);
  });

  it('rejects reversed pitch bounds', () => {
    const bounds = makeBounds({ pitch: { minMidi: 80, maxMidi: 60 } });
    const result = evaluateGeneratorRecipe(ctx, makeRequest(trivialRecipe, { bounds }), operators);
    expect(result.diagnostics.map((d) => d.code)).toContain('bounds-pitch-reversed');
    expect(result.notes).toEqual([]);
  });

  it('rejects pitch bounds outside the global MIDI range', () => {
    const bounds = makeBounds({ pitch: { minMidi: 0, maxMidi: 200 } });
    const result = evaluateGeneratorRecipe(ctx, makeRequest(trivialRecipe, { bounds }), operators);
    expect(result.diagnostics.map((d) => d.code)).toContain('bounds-pitch-out-of-range');
    expect(result.notes).toEqual([]);
  });

  it('accepts well-formed bounds', () => {
    const result = evaluateGeneratorRecipe(ctx, makeRequest(trivialRecipe), operators);
    expect(result.diagnostics).toEqual([]);
  });
});

describe('evaluateGeneratorRecipe — operator output validation', () => {
  const ctx = makeGeneratorContext();

  it('drops an undeclared output port instead of storing it for downstream nodes', () => {
    const validNotes = [makeNoteDraft({ eventKey: 'a', midiNote: 60, startBeat: 0 })];
    const operators = makeOperatorMap(
      makeCustomOperator('bad-source', { out: { kind: 'notes' } }, (_ctx, _inputs, request) => ({
        out: makeNotePlan(request.bounds, validNotes),
        extra: makeNotePlan(request.bounds, []),
      })),
    );
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'bad-source')],
      edges: [],
      output: { nodeId: 'a', port: 'out' },
    };
    const result = evaluateGeneratorRecipe(ctx, makeRequest(recipe), operators);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'undeclared-output-port', nodeId: 'a', port: 'extra' }),
    );
    expect(result.notes).toEqual(validNotes); // the declared, valid port still propagates
  });

  it('drops an array returned on a port that does not declare multiple: true', () => {
    const operators = makeOperatorMap(
      makeCustomOperator('bad-source', { out: { kind: 'notes' } }, (_ctx, _inputs, request) => ({
        out: [makeNotePlan(request.bounds, []), makeNotePlan(request.bounds, [])],
      })),
    );
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'bad-source')],
      edges: [],
      output: { nodeId: 'a', port: 'out' },
    };
    const result = evaluateGeneratorRecipe(ctx, makeRequest(recipe), operators);
    expect(result.diagnostics.map((d) => d.code)).toContain('output-multiplicity-mismatch');
    expect(result.notes).toEqual([]);
  });

  it('flags a required output port the operator never produced', () => {
    const operators = makeOperatorMap(
      makeCustomOperator('bad-source', { out: { kind: 'notes' } }, () => ({})),
    );
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'bad-source')],
      edges: [],
      output: { nodeId: 'a', port: 'out' },
    };
    const result = evaluateGeneratorRecipe(ctx, makeRequest(recipe), operators);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'missing-required-output', nodeId: 'a', port: 'out' }),
    );
    expect(result.notes).toEqual([]);
  });

  it('drops a plan whose kind does not match its declared output port, and never passes it downstream', () => {
    // Declares a 'notes' output but actually returns a HarmonyPlan — the
    // exact "operator lies about its own contract" scenario that used to
    // reach a downstream node's plan.notes.map(...) and throw.
    const operators = makeOperatorMap(
      makeCustomOperator('lying-source', { out: { kind: 'notes' } }, (_ctx, _inputs, request) => ({
        out: { kind: 'harmony', bounds: request.bounds, diagnostics: [], segments: [] },
      })),
      makeCustomOperator(
        'safe-consumer',
        { out: { kind: 'notes' } },
        (_ctx, inputs, request) => ({
          out: makeNotePlan(
            request.bounds,
            Object.hasOwn(inputs, 'in') && !Array.isArray(inputs.in) && inputs.in.kind === 'notes'
              ? inputs.in.notes
              : [],
          ),
        }),
        { inputs: { in: { kind: 'notes', optional: true } } },
      ),
    );
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'lying-source'), node('b', 'safe-consumer')],
      edges: [{ from: { nodeId: 'a', port: 'out' }, to: { nodeId: 'b', port: 'in' } }],
      output: { nodeId: 'b', port: 'out' },
    };
    expect(() => evaluateGeneratorRecipe(ctx, makeRequest(recipe), operators)).not.toThrow();
    const result = evaluateGeneratorRecipe(ctx, makeRequest(recipe), operators);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'output-kind-mismatch', nodeId: 'a', port: 'out' }),
    );
    expect(result.notes).toEqual([]); // the mismatched plan never reached "safe-consumer"
  });

  it('surfaces an operator plan’s own embedded diagnostics in the evaluation result', () => {
    const embedded = {
      level: 'warning' as const,
      code: 'test-operator-diagnostic',
      message: 'from the plan',
    };
    const operators = makeOperatorMap(
      makeCustomOperator('source', { out: { kind: 'notes' } }, (_ctx, _inputs, request) => ({
        out: { kind: 'notes', bounds: request.bounds, diagnostics: [embedded], notes: [] },
      })),
    );
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'source')],
      edges: [],
      output: { nodeId: 'a', port: 'out' },
    };
    const result = evaluateGeneratorRecipe(ctx, makeRequest(recipe), operators);
    expect(result.diagnostics).toContainEqual(embedded);
  });

  it('flags an output plan whose own bounds are invalid', () => {
    const operators = makeOperatorMap(
      makeCustomOperator('source', { out: { kind: 'notes' } }, () => ({
        out: {
          kind: 'notes',
          bounds: makeBounds({ time: { startBeat: 4, endBeat: 0 } }),
          diagnostics: [],
          notes: [],
        },
      })),
    );
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'source')],
      edges: [],
      output: { nodeId: 'a', port: 'out' },
    };
    const result = evaluateGeneratorRecipe(ctx, makeRequest(recipe), operators);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'bounds-time-reversed', nodeId: 'a', port: 'out' }),
    );
  });
});
