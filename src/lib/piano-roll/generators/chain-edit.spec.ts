import { describe, expect, it } from 'vitest';
import {
  duplicateNode,
  insertNode,
  moveNode,
  removeNode,
  resetNodeParams,
  toggleNodeEnabled,
  updateNodeParams,
} from './chain-edit.js';
import {
  makeGeneratorContext,
  makeHarmonyOnlyOperator,
  makeOperatorMap,
  makeSourceOperator,
  makeTransposeOperator,
} from './test-helpers.js';
import type { GeneratorRecipe } from './types.js';

const ctx = makeGeneratorContext();
const operators = makeOperatorMap(
  makeSourceOperator('source', [
    { eventKey: 'a', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 },
  ]),
  makeTransposeOperator('transpose-a'),
  makeTransposeOperator('transpose-b'),
  makeHarmonyOnlyOperator('harmony-only'),
);

function baseRecipe(): GeneratorRecipe {
  return {
    id: 'r',
    version: 1,
    nodes: [
      { id: 'source', operatorId: 'source', operatorVersion: 1, params: {}, enabled: true },
      {
        id: 'a',
        operatorId: 'transpose-a',
        operatorVersion: 1,
        params: { semitones: 3 },
        enabled: true,
      },
      {
        id: 'b',
        operatorId: 'transpose-b',
        operatorVersion: 1,
        params: { semitones: 5 },
        enabled: true,
      },
    ],
    edges: [
      { from: { nodeId: 'source', port: 'out' }, to: { nodeId: 'a', port: 'in' } },
      { from: { nodeId: 'a', port: 'out' }, to: { nodeId: 'b', port: 'in' } },
    ],
    output: { nodeId: 'b', port: 'out' },
  };
}

describe('moveNode', () => {
  it('swaps two adjacent compatible nodes and rewires the chain', () => {
    const result = moveNode(baseRecipe(), 'a', 'down', operators);
    expect(result.error).toBeNull();
    expect(result.recipe.nodes.map((n) => n.id)).toEqual(['source', 'b', 'a']);
    expect(result.recipe.output).toEqual({ nodeId: 'a', port: 'out' });
  });

  it('is a no-op at the start of the chain', () => {
    const recipe = baseRecipe();
    const result = moveNode(recipe, 'source', 'up', operators);
    expect(result.error).toBeNull();
    expect(result.recipe).toBe(recipe);
  });

  it('is a no-op at the end of the chain', () => {
    const recipe = baseRecipe();
    const result = moveNode(recipe, 'b', 'down', operators);
    expect(result.error).toBeNull();
    expect(result.recipe).toBe(recipe);
  });
});

describe('toggleNodeEnabled', () => {
  it('flips a node’s enabled flag without touching edges', () => {
    const recipe = baseRecipe();
    const next = toggleNodeEnabled(recipe, 'a');
    expect(next.nodes.find((n) => n.id === 'a')?.enabled).toBe(false);
    expect(next.edges).toEqual(recipe.edges);
  });
});

describe('removeNode', () => {
  it('removes a middle node and rewires source directly to the remaining node', () => {
    const result = removeNode(baseRecipe(), 'a', operators);
    expect(result.error).toBeNull();
    expect(result.recipe.nodes.map((n) => n.id)).toEqual(['source', 'b']);
    expect(result.recipe.edges).toEqual([
      { from: { nodeId: 'source', port: 'out' }, to: { nodeId: 'b', port: 'in' } },
    ]);
  });

  it('refuses to remove the only remaining node', () => {
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [
        { id: 'source', operatorId: 'source', operatorVersion: 1, params: {}, enabled: true },
      ],
      edges: [],
      output: { nodeId: 'source', port: 'out' },
    };
    const result = removeNode(recipe, 'source', operators);
    expect(result.error).not.toBeNull();
    expect(result.recipe).toBe(recipe);
  });
});

describe('duplicateNode', () => {
  it('inserts a clone with a new id right after the original', () => {
    const result = duplicateNode(baseRecipe(), 'a', operators);
    expect(result.error).toBeNull();
    const ids = result.recipe.nodes.map((n) => n.id);
    expect(ids[1]).toBe('a');
    expect(ids).toHaveLength(4);
    const clone = result.recipe.nodes[2];
    expect(clone.id).not.toBe('a');
    expect(clone.operatorId).toBe('transpose-a');
    expect(clone.params).toEqual({ semitones: 3 });
  });
});

describe('resetNodeParams', () => {
  it('resets a node’s params to the operator’s defaults', () => {
    const recipe = baseRecipe();
    const next = resetNodeParams(recipe, 'a', ctx, operators);
    expect(next.nodes.find((n) => n.id === 'a')?.params).toEqual({ semitones: 0 });
  });
});

describe('updateNodeParams', () => {
  it('merges new params without clobbering existing keys', () => {
    const recipe: GeneratorRecipe = baseRecipe();
    const withExtra = updateNodeParams(recipe, 'a', { semitones: 3 });
    const next = updateNodeParams(withExtra, 'a', { extra: true });
    expect(next.nodes.find((n) => n.id === 'a')?.params).toEqual({ semitones: 3, extra: true });
  });
});

describe('insertNode', () => {
  it('appends a compatible module after the given node', () => {
    const result = insertNode(baseRecipe(), 'transpose-a', ctx, operators, 'source');
    expect(result.error).toBeNull();
    expect(result.recipe.nodes.map((n) => n.operatorId)).toEqual([
      'source',
      'transpose-a',
      'transpose-a',
      'transpose-b',
    ]);
  });

  it('appends at the end of the chain when no anchor node is given', () => {
    const result = insertNode(baseRecipe(), 'transpose-a', ctx, operators);
    expect(result.error).toBeNull();
    expect(result.recipe.nodes.at(-1)?.operatorId).toBe('transpose-a');
    expect(result.recipe.output.nodeId).toBe(result.recipe.nodes.at(-1)?.id);
  });

  it('rejects an incompatible module without mutating the recipe', () => {
    const recipe = baseRecipe();
    const result = insertNode(recipe, 'harmony-only', ctx, operators);
    expect(result.error).not.toBeNull();
    expect(result.recipe).toBe(recipe);
  });
});
