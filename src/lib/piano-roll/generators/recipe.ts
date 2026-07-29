// Domain layer — recipe validation, cycle rejection, and automatic wiring
// (generators.md §4.9, §4.10, §11).

import type {
  GeneratorDiagnostic,
  GeneratorEdge,
  GeneratorNodeInstance,
  GeneratorOperatorDescriptor,
  GeneratorRecipe,
  PlanPort,
} from './types.js';

/**
 * Deterministic topological order of `recipe.nodes`, breaking ties by
 * original node declaration order (rather than edge-processing order) so
 * evaluation and trace output are stable across runs. Returns `null` when
 * the graph contains a cycle — V1 must reject cycles (generators.md §4.9).
 */
export function topologicalSort(recipe: GeneratorRecipe): string[] | null {
  const nodeIds = recipe.nodes.map((n) => n.id);
  const indegree = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  const outgoing = new Map<string, string[]>(nodeIds.map((id) => [id, []]));

  for (const edge of recipe.edges) {
    if (!indegree.has(edge.from.nodeId) || !indegree.has(edge.to.nodeId)) continue;
    outgoing.get(edge.from.nodeId)?.push(edge.to.nodeId);
    indegree.set(edge.to.nodeId, (indegree.get(edge.to.nodeId) ?? 0) + 1);
  }

  const remaining = new Set(nodeIds);
  const order: string[] = [];
  while (remaining.size > 0) {
    const next = nodeIds.find((id) => remaining.has(id) && indegree.get(id) === 0);
    if (!next) return null; // cycle: every remaining node still has an unresolved incoming edge
    order.push(next);
    remaining.delete(next);
    for (const target of outgoing.get(next) ?? []) {
      indegree.set(target, (indegree.get(target) ?? 0) - 1);
    }
  }
  return order;
}

/**
 * Structural validation of a recipe against the registered operators: node
 * ids, operator versions, port existence/compatibility, required inputs,
 * connection multiplicity, cycles, and the final output reference
 * (generators.md §5 evaluator steps 1-2). Pure — never mutates `recipe`.
 */
export function validateRecipe(
  recipe: GeneratorRecipe,
  operators: ReadonlyMap<string, GeneratorOperatorDescriptor>,
): GeneratorDiagnostic[] {
  const diagnostics: GeneratorDiagnostic[] = [];
  const seenNodeIds = new Set<string>();
  const operatorByNodeId = new Map<string, GeneratorOperatorDescriptor>();

  for (const node of recipe.nodes) {
    if (seenNodeIds.has(node.id)) {
      diagnostics.push({
        level: 'error',
        code: 'duplicate-node-id',
        message: `Duplicate node id "${node.id}".`,
        nodeId: node.id,
      });
      continue;
    }
    seenNodeIds.add(node.id);

    const operator = operators.get(node.operatorId);
    if (!operator) {
      diagnostics.push({
        level: 'error',
        code: 'unknown-operator',
        message: `Node "${node.id}" references unknown operator "${node.operatorId}".`,
        nodeId: node.id,
      });
      continue;
    }
    operatorByNodeId.set(node.id, operator);

    if (operator.version !== node.operatorVersion) {
      diagnostics.push({
        level: 'error',
        code: 'operator-version-mismatch',
        message: `Node "${node.id}" pins operator "${node.operatorId}" version ${String(node.operatorVersion)}, but the registered version is ${String(operator.version)}.`,
        nodeId: node.id,
      });
    }
  }

  const incomingCountByPort = new Map<string, number>();
  for (const edge of recipe.edges) {
    const fromOperator = operatorByNodeId.get(edge.from.nodeId);
    const toOperator = operatorByNodeId.get(edge.to.nodeId);
    if (!fromOperator) {
      diagnostics.push({
        level: 'error',
        code: 'edge-unknown-source-node',
        message: `Edge references unknown source node "${edge.from.nodeId}".`,
      });
      continue;
    }
    if (!toOperator) {
      diagnostics.push({
        level: 'error',
        code: 'edge-unknown-target-node',
        message: `Edge references unknown target node "${edge.to.nodeId}".`,
      });
      continue;
    }

    if (!Object.hasOwn(fromOperator.outputs, edge.from.port)) {
      diagnostics.push({
        level: 'error',
        code: 'edge-unknown-output-port',
        message: `Edge references unknown output port "${edge.from.port}" on node "${edge.from.nodeId}".`,
        nodeId: edge.from.nodeId,
        port: edge.from.port,
      });
      continue;
    }
    if (!Object.hasOwn(toOperator.inputs, edge.to.port)) {
      diagnostics.push({
        level: 'error',
        code: 'edge-unknown-input-port',
        message: `Edge references unknown input port "${edge.to.port}" on node "${edge.to.nodeId}".`,
        nodeId: edge.to.nodeId,
        port: edge.to.port,
      });
      continue;
    }
    const outputPort = fromOperator.outputs[edge.from.port];
    const inputPort = toOperator.inputs[edge.to.port];
    if (outputPort.kind !== inputPort.kind) {
      diagnostics.push({
        level: 'error',
        code: 'edge-port-kind-mismatch',
        message: `Edge from "${edge.from.nodeId}.${edge.from.port}" (${outputPort.kind}) to "${edge.to.nodeId}.${edge.to.port}" (${inputPort.kind}) connects incompatible plan kinds.`,
        nodeId: edge.to.nodeId,
        port: edge.to.port,
      });
      continue;
    }

    const key = `${edge.to.nodeId}:${edge.to.port}`;
    incomingCountByPort.set(key, (incomingCountByPort.get(key) ?? 0) + 1);
  }

  for (const node of recipe.nodes) {
    const operator = operatorByNodeId.get(node.id);
    if (!operator) continue;
    for (const [portKey, port] of Object.entries<PlanPort>(operator.inputs)) {
      const count = incomingCountByPort.get(`${node.id}:${portKey}`) ?? 0;
      if (!port.multiple && count > 1) {
        diagnostics.push({
          level: 'error',
          code: 'port-overconnected',
          message: `Input port "${node.id}.${portKey}" accepts a single connection but has ${String(count)}.`,
          nodeId: node.id,
          port: portKey,
        });
      }
      if (!port.optional && count === 0) {
        diagnostics.push({
          level: 'error',
          code: 'missing-required-input',
          message: `Required input port "${node.id}.${portKey}" has no connection.`,
          nodeId: node.id,
          port: portKey,
        });
      }
    }
  }

  if (topologicalSort(recipe) === null) {
    diagnostics.push({
      level: 'error',
      code: 'cycle-detected',
      message: 'The recipe graph contains a cycle.',
    });
  }

  const outputNode = recipe.nodes.find((n) => n.id === recipe.output.nodeId);
  if (!outputNode) {
    diagnostics.push({
      level: 'error',
      code: 'unknown-output-node',
      message: `Recipe output references unknown node "${recipe.output.nodeId}".`,
    });
  } else {
    const outputOperator = operatorByNodeId.get(outputNode.id);
    if (outputOperator && !Object.hasOwn(outputOperator.outputs, recipe.output.port)) {
      diagnostics.push({
        level: 'error',
        code: 'unknown-output-port',
        message: `Recipe output references unknown port "${recipe.output.port}" on node "${outputNode.id}".`,
        nodeId: outputNode.id,
        port: recipe.output.port,
      });
    }
  }

  return diagnostics;
}

/** The first declared (from-output, to-input) pair sharing a plan kind — "primary" per generators.md §4.10. */
function findCompatiblePorts(
  fromOperator: GeneratorOperatorDescriptor,
  toOperator: GeneratorOperatorDescriptor,
): { fromPort: string; toPort: string } | null {
  for (const [outputKey, outputPort] of Object.entries<PlanPort>(fromOperator.outputs)) {
    for (const [inputKey, inputPort] of Object.entries<PlanPort>(toOperator.inputs)) {
      if (outputPort.kind === inputPort.kind) {
        return { fromPort: outputKey, toPort: inputKey };
      }
    }
  }
  return null;
}

export interface AutoWireResult {
  edges: GeneratorEdge[];
  diagnostics: GeneratorDiagnostic[];
}

/**
 * Automatic serial wiring (generators.md §4.10 rules 1, 2, 5): connects each
 * node to the previous node's first compatible output/input pair, in the
 * order `nodes` is given. Adapter insertion (rule 4) and the multi-option
 * chooser (rule 6) are UI-phase concerns and not implemented here — an
 * unwireable pair is reported as a diagnostic rather than guessed at.
 */
export function autoWireSerial(
  nodes: GeneratorNodeInstance[],
  operators: ReadonlyMap<string, GeneratorOperatorDescriptor>,
): AutoWireResult {
  const edges: GeneratorEdge[] = [];
  const diagnostics: GeneratorDiagnostic[] = [];

  for (let i = 1; i < nodes.length; i++) {
    const previous = nodes[i - 1];
    const current = nodes[i];
    const previousOperator = operators.get(previous.operatorId);
    const currentOperator = operators.get(current.operatorId);
    if (!previousOperator || !currentOperator) {
      diagnostics.push({
        level: 'error',
        code: 'unknown-operator',
        message: `Cannot wire node "${current.id}": unknown operator.`,
        nodeId: current.id,
      });
      continue;
    }

    const match = findCompatiblePorts(previousOperator, currentOperator);
    if (!match) {
      diagnostics.push({
        level: 'error',
        code: 'no-compatible-connection',
        message: `No compatible connection from "${previous.id}" to "${current.id}"; required input on "${current.id}" has no matching output on "${previous.id}".`,
        nodeId: current.id,
      });
      continue;
    }

    edges.push({
      from: { nodeId: previous.id, port: match.fromPort },
      to: { nodeId: current.id, port: match.toPort },
    });
  }

  return { edges, diagnostics };
}
