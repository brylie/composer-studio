import { describe, expect, it } from 'vitest';
import { evaluateGeneratorRecipe } from './evaluator.js';
import {
  makeBounds,
  makeGeneratorContext,
  makeHarmonyOnlyOperator,
  makeHarmonySourceOperator,
  makeManyNotesSourceOperator,
  makeMergeOperator,
  makeNoteDraft,
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

  it('keeps a locked dimension stable across rerolls', () => {
    const operators = makeOperatorMap(makeSeededPitchSourceOperator('source'));
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'source')],
      edges: [],
      output: { nodeId: 'a', port: 'out' },
    };
    const lockedVariation = makeVariation({
      seed: 7,
      locks: { ...makeVariation().locks, pitch: true },
    });
    const lockedPitches = Array.from(
      { length: 5 },
      (_, generation) =>
        evaluateGeneratorRecipe(
          ctx,
          makeRequest(recipe, { variation: { ...lockedVariation, generation } }),
          operators,
        ).notes[0].midiNote,
    );
    expect(new Set(lockedPitches).size).toBe(1);
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
