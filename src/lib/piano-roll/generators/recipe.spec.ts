import { describe, expect, it } from 'vitest';
import { autoWireSerial, topologicalSort, validateRecipe } from './recipe.js';
import {
  makeHarmonyOnlyOperator,
  makeMergeOperator,
  makeOperatorMap,
  makeSourceOperator,
  makeTransposeOperator,
} from './test-helpers.js';
import type { GeneratorRecipe } from './types.js';

const node = (id: string, operatorId: string, version = 1) => ({
  id,
  operatorId,
  operatorVersion: version,
  params: {},
  enabled: true,
});

describe('topologicalSort', () => {
  it('orders a serial chain source -> processor -> processor', () => {
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('c', 'transpose'), node('a', 'source'), node('b', 'transpose')],
      edges: [
        { from: { nodeId: 'a', port: 'out' }, to: { nodeId: 'b', port: 'in' } },
        { from: { nodeId: 'b', port: 'out' }, to: { nodeId: 'c', port: 'in' } },
      ],
      output: { nodeId: 'c', port: 'out' },
    };
    expect(topologicalSort(recipe)).toEqual(['a', 'b', 'c']);
  });

  it('is stable across repeated calls on the same recipe', () => {
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'source'), node('b', 'transpose'), node('c', 'transpose')],
      edges: [
        { from: { nodeId: 'a', port: 'out' }, to: { nodeId: 'b', port: 'in' } },
        { from: { nodeId: 'a', port: 'out' }, to: { nodeId: 'c', port: 'in' } },
      ],
      output: { nodeId: 'b', port: 'out' },
    };
    const first = topologicalSort(recipe);
    const second = topologicalSort(recipe);
    expect(first).toEqual(second);
  });

  it('returns null for a cycle', () => {
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
    expect(topologicalSort(recipe)).toBeNull();
  });
});

describe('validateRecipe', () => {
  const operators = makeOperatorMap(
    makeSourceOperator('source', []),
    makeTransposeOperator('transpose'),
    makeMergeOperator('merge'),
    makeHarmonyOnlyOperator('harmony-only'),
  );

  it('accepts a valid serial chain', () => {
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'source'), node('b', 'transpose')],
      edges: [{ from: { nodeId: 'a', port: 'out' }, to: { nodeId: 'b', port: 'in' } }],
      output: { nodeId: 'b', port: 'out' },
    };
    expect(validateRecipe(recipe, operators)).toEqual([]);
  });

  it('flags a duplicate node id', () => {
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'source'), node('a', 'transpose')],
      edges: [],
      output: { nodeId: 'a', port: 'out' },
    };
    expect(validateRecipe(recipe, operators).map((d) => d.code)).toContain('duplicate-node-id');
  });

  it('flags an unknown operator', () => {
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'nonexistent')],
      edges: [],
      output: { nodeId: 'a', port: 'out' },
    };
    expect(validateRecipe(recipe, operators).map((d) => d.code)).toContain('unknown-operator');
  });

  it('flags a mismatched operator version', () => {
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'source', 99)],
      edges: [],
      output: { nodeId: 'a', port: 'out' },
    };
    expect(validateRecipe(recipe, operators).map((d) => d.code)).toContain(
      'operator-version-mismatch',
    );
  });

  it('flags an edge connecting incompatible plan kinds', () => {
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'source'), node('b', 'harmony-only')],
      edges: [{ from: { nodeId: 'a', port: 'out' }, to: { nodeId: 'b', port: 'in' } }],
      output: { nodeId: 'b', port: 'out' },
    };
    expect(validateRecipe(recipe, operators).map((d) => d.code)).toContain(
      'edge-port-kind-mismatch',
    );
  });

  it('flags a required input with no connection', () => {
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'transpose')],
      edges: [],
      output: { nodeId: 'a', port: 'out' },
    };
    expect(validateRecipe(recipe, operators).map((d) => d.code)).toContain(
      'missing-required-input',
    );
  });

  it('flags a single-connection port receiving more than one edge', () => {
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'source'), node('b', 'source'), node('c', 'transpose')],
      edges: [
        { from: { nodeId: 'a', port: 'out' }, to: { nodeId: 'c', port: 'in' } },
        { from: { nodeId: 'b', port: 'out' }, to: { nodeId: 'c', port: 'in' } },
      ],
      output: { nodeId: 'c', port: 'out' },
    };
    expect(validateRecipe(recipe, operators).map((d) => d.code)).toContain('port-overconnected');
  });

  it('allows multiple edges into a `multiple` port', () => {
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'source'), node('b', 'source'), node('c', 'merge')],
      edges: [
        { from: { nodeId: 'a', port: 'out' }, to: { nodeId: 'c', port: 'in' } },
        { from: { nodeId: 'b', port: 'out' }, to: { nodeId: 'c', port: 'in' } },
      ],
      output: { nodeId: 'c', port: 'out' },
    };
    expect(validateRecipe(recipe, operators)).toEqual([]);
  });

  it('rejects cycles', () => {
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
    expect(validateRecipe(recipe, operators).map((d) => d.code)).toContain('cycle-detected');
  });

  it('flags an output referencing an unknown node', () => {
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'source')],
      edges: [],
      output: { nodeId: 'missing', port: 'out' },
    };
    expect(validateRecipe(recipe, operators).map((d) => d.code)).toContain('unknown-output-node');
  });

  it('flags an output referencing an unknown port', () => {
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'source')],
      edges: [],
      output: { nodeId: 'a', port: 'nonexistent' },
    };
    expect(validateRecipe(recipe, operators).map((d) => d.code)).toContain('unknown-output-port');
  });

  it('never mutates the recipe it validates', () => {
    const recipe: GeneratorRecipe = {
      id: 'r',
      version: 1,
      nodes: [node('a', 'source'), node('b', 'transpose')],
      edges: [{ from: { nodeId: 'a', port: 'out' }, to: { nodeId: 'b', port: 'in' } }],
      output: { nodeId: 'b', port: 'out' },
    };
    const clone = structuredClone(recipe);
    validateRecipe(recipe, operators);
    expect(recipe).toEqual(clone);
  });
});

describe('autoWireSerial', () => {
  const operators = makeOperatorMap(
    makeSourceOperator('source', []),
    makeTransposeOperator('transpose'),
  );

  it('wires each node to the previous node’s first compatible ports', () => {
    const nodes = [node('a', 'source'), node('b', 'transpose'), node('c', 'transpose')];
    const result = autoWireSerial(nodes, operators);
    expect(result.diagnostics).toEqual([]);
    expect(result.edges).toEqual([
      { from: { nodeId: 'a', port: 'out' }, to: { nodeId: 'b', port: 'in' } },
      { from: { nodeId: 'b', port: 'out' }, to: { nodeId: 'c', port: 'in' } },
    ]);
  });

  it('produces no edges for a single node', () => {
    expect(autoWireSerial([node('a', 'source')], operators).edges).toEqual([]);
  });

  it('rejects a drop with no compatible connection instead of guessing', () => {
    const harmonyOperators = makeOperatorMap(
      makeSourceOperator('source', []),
      makeHarmonyOnlyOperator('harmony-only'),
    );
    const result = autoWireSerial(
      [node('a', 'source'), node('b', 'harmony-only')],
      harmonyOperators,
    );
    expect(result.edges).toEqual([]);
    expect(result.diagnostics.map((d) => d.code)).toContain('no-compatible-connection');
  });
});
