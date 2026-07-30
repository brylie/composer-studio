// Domain layer — serial recipe-chain editing for the inspector's module
// actions (generators.md §7.2, §18 Phase C: insert, reorder, bypass,
// duplicate, reset, remove). V1's inspector presents a recipe as a single
// automatically-wired serial chain (generators.md §4.9's "a serial chain is
// the default presentation"), so these operate on `recipe.nodes` order
// directly and re-derive edges/output via autoWireSerial afterward, rather
// than accepting caller-supplied edges. A structural edit that would leave
// no valid wiring is rejected — the caller gets the original recipe back
// plus an explanation, per generators.md §4.10 rule 5 ("no valid connection
// → reject ... and explain"), instead of silently landing a broken chain.

import { autoWireSerial } from './recipe.js';
import type {
  GeneratorContext,
  GeneratorNodeInstance,
  GeneratorOperatorDescriptor,
  GeneratorRecipe,
} from './types.js';

export interface ChainEditResult {
  recipe: GeneratorRecipe;
  error: string | null;
}

function outputPortFor(
  node: GeneratorNodeInstance,
  operators: ReadonlyMap<string, GeneratorOperatorDescriptor>,
): string | null {
  const operator = operators.get(node.operatorId);
  if (!operator) return null;
  const ports = Object.entries(operator.outputs);
  if (ports.length === 0) return null;
  const notesPort = ports.find(([, port]) => port.kind === 'notes');
  return (notesPort ?? ports[0])[0];
}

function rewire(
  recipe: GeneratorRecipe,
  nodes: GeneratorNodeInstance[],
  operators: ReadonlyMap<string, GeneratorOperatorDescriptor>,
): ChainEditResult {
  if (nodes.length === 0) {
    return { recipe, error: 'A recipe needs at least one module.' };
  }
  const wiring = autoWireSerial(nodes, operators);
  if (wiring.diagnostics.length > 0) {
    return { recipe, error: wiring.diagnostics[0].message };
  }
  const lastNode = nodes[nodes.length - 1];
  const port = outputPortFor(lastNode, operators);
  if (!port) {
    return { recipe, error: `Unknown operator "${lastNode.operatorId}".` };
  }
  return {
    recipe: { ...recipe, nodes, edges: wiring.edges, output: { nodeId: lastNode.id, port } },
    error: null,
  };
}

export function moveNode(
  recipe: GeneratorRecipe,
  nodeId: string,
  direction: 'up' | 'down',
  operators: ReadonlyMap<string, GeneratorOperatorDescriptor>,
): ChainEditResult {
  const index = recipe.nodes.findIndex((n) => n.id === nodeId);
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (index === -1 || targetIndex < 0 || targetIndex >= recipe.nodes.length) {
    return { recipe, error: null };
  }
  const nodes = [...recipe.nodes];
  [nodes[index], nodes[targetIndex]] = [nodes[targetIndex], nodes[index]];
  return rewire(recipe, nodes, operators);
}

/** Bypass toggle only — never touches wiring (generators.md §6.2: the evaluator itself handles a disabled node's passthrough). */
export function toggleNodeEnabled(recipe: GeneratorRecipe, nodeId: string): GeneratorRecipe {
  return {
    ...recipe,
    nodes: recipe.nodes.map((n) => (n.id === nodeId ? { ...n, enabled: !n.enabled } : n)),
  };
}

export function removeNode(
  recipe: GeneratorRecipe,
  nodeId: string,
  operators: ReadonlyMap<string, GeneratorOperatorDescriptor>,
): ChainEditResult {
  if (recipe.nodes.length <= 1) {
    return { recipe, error: 'A recipe needs at least one module.' };
  }
  const nodes = recipe.nodes.filter((n) => n.id !== nodeId);
  return rewire(recipe, nodes, operators);
}

export function duplicateNode(
  recipe: GeneratorRecipe,
  nodeId: string,
  operators: ReadonlyMap<string, GeneratorOperatorDescriptor>,
): ChainEditResult {
  const index = recipe.nodes.findIndex((n) => n.id === nodeId);
  if (index === -1) return { recipe, error: null };
  const clone: GeneratorNodeInstance = {
    ...recipe.nodes[index],
    id: crypto.randomUUID(),
    params: { ...recipe.nodes[index].params },
  };
  const nodes = [...recipe.nodes.slice(0, index + 1), clone, ...recipe.nodes.slice(index + 1)];
  return rewire(recipe, nodes, operators);
}

export function resetNodeParams(
  recipe: GeneratorRecipe,
  nodeId: string,
  ctx: GeneratorContext,
  operators: ReadonlyMap<string, GeneratorOperatorDescriptor>,
): GeneratorRecipe {
  const node = recipe.nodes.find((n) => n.id === nodeId);
  const operator = node && operators.get(node.operatorId);
  if (!node || !operator) return recipe;
  return {
    ...recipe,
    nodes: recipe.nodes.map((n) =>
      n.id === nodeId ? { ...n, params: operator.getDefaultParams(ctx) } : n,
    ),
  };
}

export function updateNodeParams(
  recipe: GeneratorRecipe,
  nodeId: string,
  params: Record<string, unknown>,
): GeneratorRecipe {
  return {
    ...recipe,
    nodes: recipe.nodes.map((n) =>
      n.id === nodeId ? { ...n, params: { ...n.params, ...params } } : n,
    ),
  };
}

/** Appends a new node after `afterNodeId` (defaults to the end of the chain) — generators.md §7.4's "dropping a module onto the session appends it". */
export function insertNode(
  recipe: GeneratorRecipe,
  operatorId: string,
  ctx: GeneratorContext,
  operators: ReadonlyMap<string, GeneratorOperatorDescriptor>,
  afterNodeId?: string,
): ChainEditResult {
  const descriptor = operators.get(operatorId);
  if (!descriptor) {
    return { recipe, error: `Unknown operator "${operatorId}".` };
  }
  const node: GeneratorNodeInstance = {
    id: crypto.randomUUID(),
    operatorId,
    operatorVersion: descriptor.version,
    params: descriptor.getDefaultParams(ctx),
    enabled: true,
  };
  const afterIndex = afterNodeId
    ? recipe.nodes.findIndex((n) => n.id === afterNodeId)
    : recipe.nodes.length - 1;
  const insertAt = afterIndex === -1 ? recipe.nodes.length : afterIndex + 1;
  const nodes = [...recipe.nodes.slice(0, insertAt), node, ...recipe.nodes.slice(insertAt)];
  return rewire(recipe, nodes, operators);
}
