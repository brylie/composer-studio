// Domain layer — recipe pipeline evaluation (generators.md §5).
//
// evaluateGeneratorRecipe and every GeneratorOperatorDescriptor.process() it
// calls are pure: no application-state mutation, no permanent note ids, no
// history, no audio, no DOM, no Math.random(), no Svelte imports.

import { deriveSeed } from './random.js';
import { topologicalSort, validateRecipe } from './recipe.js';
import type {
  GeneratorContext,
  GeneratorDiagnostic,
  GeneratorEvaluationRequest,
  GeneratorNodeInstance,
  GeneratorOperatorDescriptor,
  GeneratorResult,
  MusicPlan,
  NotePlan,
  VariationState,
} from './types.js';
import { validateGeneratedResult } from './validation.js';

function emptyNotePlan(bounds: GeneratorEvaluationRequest['bounds']): NotePlan {
  return { kind: 'notes', bounds, diagnostics: [], notes: [] };
}

/** A node's own sub-seed, independent of every other node's (generators.md §5 evaluator step 4). */
function nodeVariation(base: VariationState, nodeId: string): VariationState {
  return { ...base, seed: deriveSeed(base.seed, base.generation, nodeId) };
}

/**
 * A disabled node's fallback behavior (generators.md §6.2 "bypasses ... a
 * module"): for each output port, pass through the input port sharing its
 * plan kind unchanged, without calling process(). A node whose input and
 * output ports are 1:1 same-kind ("identity-capable") passes its plan
 * through exactly; a node with no matching input for some output port
 * simply omits that port rather than guessing.
 */
function bypassOutputs(
  node: GeneratorNodeInstance,
  operator: GeneratorOperatorDescriptor,
  inputs: Record<string, MusicPlan | MusicPlan[]>,
): { outputs: Record<string, MusicPlan | MusicPlan[]>; diagnostics: GeneratorDiagnostic[] } {
  const outputs: Record<string, MusicPlan | MusicPlan[]> = {};
  const diagnostics: GeneratorDiagnostic[] = [];

  for (const [outputKey, outputPort] of Object.entries(operator.outputs)) {
    const matchingInput = Object.entries(operator.inputs).find(
      ([, port]) => port.kind === outputPort.kind,
    );
    const value = matchingInput ? inputs[matchingInput[0]] : undefined;
    if (value !== undefined) {
      outputs[outputKey] = value;
    } else {
      diagnostics.push({
        level: 'info',
        code: 'bypass-no-passthrough',
        message: `Disabled node "${node.id}" has no matching input for output port "${outputKey}"; the port was omitted.`,
        nodeId: node.id,
        port: outputKey,
      });
    }
  }

  return { outputs, diagnostics };
}

/**
 * Runs a recipe: validates it, topologically sorts it, runs each enabled
 * operator exactly once (or bypasses a disabled one), and renders the
 * recipe's declared output into note drafts. Never throws on an invalid
 * recipe — validation failures come back as `'error'`-level diagnostics with
 * an empty result instead.
 */
export function evaluateGeneratorRecipe(
  ctx: GeneratorContext,
  request: GeneratorEvaluationRequest,
  operators: ReadonlyMap<string, GeneratorOperatorDescriptor>,
): GeneratorResult {
  const { recipe, bounds, variation, includeTrace } = request;
  const diagnostics: GeneratorDiagnostic[] = [...validateRecipe(recipe, operators)];

  if (diagnostics.some((d) => d.level === 'error')) {
    return { output: emptyNotePlan(bounds), notes: [], diagnostics };
  }

  const order = topologicalSort(recipe);
  if (!order) {
    // validateRecipe already checks for cycles, so this is unreachable in
    // practice; kept as a defensive fallback rather than a non-null assertion.
    diagnostics.push({
      level: 'error',
      code: 'cycle-detected',
      message: 'The recipe graph contains a cycle.',
    });
    return { output: emptyNotePlan(bounds), notes: [], diagnostics };
  }

  const nodesById = new Map(recipe.nodes.map((n) => [n.id, n]));
  const outputsByNode = new Map<string, Record<string, MusicPlan | MusicPlan[]>>();
  const trace: { nodeId: string; outputs: Record<string, MusicPlan | MusicPlan[]> }[] = [];

  for (const nodeId of order) {
    const node = nodesById.get(nodeId);
    const operator = node && operators.get(node.operatorId);
    if (!node || !operator) continue; // unreachable: validateRecipe already confirmed both exist

    const multiInputs = new Map<string, (MusicPlan | MusicPlan[])[]>();
    const inputs: Record<string, MusicPlan | MusicPlan[]> = {};
    for (const edge of recipe.edges) {
      if (edge.to.nodeId !== node.id) continue;
      const upstream = outputsByNode.get(edge.from.nodeId)?.[edge.from.port];
      if (upstream === undefined) continue;
      if (operator.inputs[edge.to.port].multiple) {
        const list = multiInputs.get(edge.to.port) ?? [];
        list.push(upstream);
        multiInputs.set(edge.to.port, list);
      } else {
        inputs[edge.to.port] = upstream;
      }
    }
    for (const [port, values] of multiInputs) {
      inputs[port] = values.flatMap((value) => (Array.isArray(value) ? value : [value]));
    }

    let outputs: Record<string, MusicPlan | MusicPlan[]>;
    if (!node.enabled) {
      const bypassed = bypassOutputs(node, operator, inputs);
      outputs = bypassed.outputs;
      diagnostics.push(...bypassed.diagnostics);
    } else {
      outputs = operator.process(ctx, inputs, {
        bounds,
        params: node.params,
        variation: nodeVariation(variation, node.id),
        nodeId: node.id,
      });
    }

    outputsByNode.set(node.id, outputs);
    if (includeTrace) trace.push({ nodeId: node.id, outputs });
  }

  const finalOutput = outputsByNode.get(recipe.output.nodeId)?.[recipe.output.port];
  const finalTrace = includeTrace ? trace : undefined;

  if (!finalOutput || Array.isArray(finalOutput)) {
    diagnostics.push({
      level: 'error',
      code: 'invalid-recipe-output',
      message: `Recipe output "${recipe.output.nodeId}.${recipe.output.port}" did not produce a single plan.`,
    });
    return { output: emptyNotePlan(bounds), notes: [], diagnostics, trace: finalTrace };
  }

  if (finalOutput.kind !== 'notes') {
    diagnostics.push({
      level: 'error',
      code: 'output-not-notes',
      message: `Recipe output "${recipe.output.nodeId}.${recipe.output.port}" is a "${finalOutput.kind}" plan, not a note plan.`,
    });
    return { output: finalOutput, notes: [], diagnostics, trace: finalTrace };
  }

  let notes = finalOutput.notes;
  const resultDiagnostics = validateGeneratedResult(
    { output: finalOutput, notes, diagnostics: [] },
    bounds,
  );
  diagnostics.push(...resultDiagnostics);

  // "returns a diagnostic and no preview rather than silently truncating" (generators.md §14).
  if (resultDiagnostics.some((d) => d.code === 'max-notes-exceeded')) {
    notes = [];
  }

  return { output: finalOutput, notes, diagnostics, trace: finalTrace };
}
