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
import { validateGeneratedResult, validateGeneratorBounds } from './validation.js';

function emptyNotePlan(bounds: GeneratorEvaluationRequest['bounds']): NotePlan {
  return { kind: 'notes', bounds, diagnostics: [], notes: [] };
}

/**
 * A node's own sub-seed, independent of every other node's (generators.md §5
 * evaluator step 4) — and independent of `generation`, so a locked dimension
 * can derive a sub-seed from `variation.seed` that stays put across rerolls
 * instead of changing on every generation bump. Operators combine this seed
 * with `variation.generation` themselves (only when the dimension is
 * unlocked) via `deriveSeed(variation.seed, variation.generation, 'pitch')`.
 */
function nodeVariation(base: VariationState, nodeId: string): VariationState {
  return { ...base, seed: deriveSeed(base.seed, 0, nodeId) };
}

/**
 * Validates the record an operator's process() (or bypassOutputs) actually
 * produced against its own descriptor (generators.md §5 evaluator step 6):
 * undeclared ports, array-vs-single shape against `multiple`, plan kind, and
 * required-output presence. A port that fails any check is dropped instead
 * of being stored for downstream nodes — e.g. an
 * operator declaring a 'notes' output that accidentally returns a
 * HarmonyPlan must not reach a downstream node that calls
 * `plan.notes.map(...)`. A port already flagged by one of those checks is
 * excluded from the required-output pass below it, so a single bad value
 * doesn't also get reported as "missing" on top of its specific diagnostic.
 * Each surviving plan's own bounds and diagnostics are also folded in — the
 * latter deduped against `seenPlans`, since a bypassed (disabled) node
 * passes its input plan through by reference, and without dedup the same
 * plan's embedded diagnostics would be re-appended once per bypass hop it
 * flows through — so operator-level diagnostics aren't silently dropped
 * just because they didn't happen to be on the recipe's final output.
 */
function validateOperatorOutputs(
  node: GeneratorNodeInstance,
  operator: GeneratorOperatorDescriptor,
  outputs: Record<string, MusicPlan | MusicPlan[]>,
  seenPlans: Set<MusicPlan>,
): { outputs: Record<string, MusicPlan | MusicPlan[]>; diagnostics: GeneratorDiagnostic[] } {
  const validated: Record<string, MusicPlan | MusicPlan[]> = {};
  const diagnostics: GeneratorDiagnostic[] = [];
  const failedPorts = new Set<string>();

  for (const [portKey, value] of Object.entries(outputs)) {
    if (!Object.hasOwn(operator.outputs, portKey)) {
      diagnostics.push({
        level: 'error',
        code: 'undeclared-output-port',
        message: `Node "${node.id}" returned an undeclared output port "${portKey}".`,
        nodeId: node.id,
        port: portKey,
      });
      continue;
    }

    const port = operator.outputs[portKey];
    const isArray = Array.isArray(value);
    if (isArray && !port.multiple) {
      diagnostics.push({
        level: 'error',
        code: 'output-multiplicity-mismatch',
        message: `Node "${node.id}" output port "${portKey}" returned multiple plans, but the port does not declare multiple: true.`,
        nodeId: node.id,
        port: portKey,
      });
      failedPorts.add(portKey);
      continue;
    }

    const plans = isArray ? value : [value];
    const mismatched = plans.find((plan) => plan.kind !== port.kind);
    if (mismatched) {
      diagnostics.push({
        level: 'error',
        code: 'output-kind-mismatch',
        message: `Node "${node.id}" output port "${portKey}" declares "${port.kind}" but produced "${mismatched.kind}".`,
        nodeId: node.id,
        port: portKey,
      });
      failedPorts.add(portKey);
      continue;
    }

    for (const plan of plans) {
      diagnostics.push(
        ...validateGeneratorBounds(plan.bounds).map((d) => ({
          ...d,
          nodeId: node.id,
          port: portKey,
        })),
      );
      if (!seenPlans.has(plan)) {
        seenPlans.add(plan);
        diagnostics.push(...plan.diagnostics);
      }
    }
    validated[portKey] = value;
  }

  for (const [portKey, port] of Object.entries(operator.outputs)) {
    if (!port.optional && !Object.hasOwn(validated, portKey) && !failedPorts.has(portKey)) {
      diagnostics.push({
        level: 'error',
        code: 'missing-required-output',
        message: `Node "${node.id}" did not produce its required output port "${portKey}".`,
        nodeId: node.id,
        port: portKey,
      });
    }
  }

  return { outputs: validated, diagnostics };
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
  const diagnostics: GeneratorDiagnostic[] = [
    ...validateGeneratorBounds(bounds),
    ...validateRecipe(recipe, operators),
  ];

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
  const seenPlans = new Set<MusicPlan>();

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

    const validatedOutputs = validateOperatorOutputs(node, operator, outputs, seenPlans);
    diagnostics.push(...validatedOutputs.diagnostics);
    outputs = validatedOutputs.outputs;

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
  let output: MusicPlan = finalOutput;
  const resultDiagnostics = validateGeneratedResult(
    { output: finalOutput, notes, diagnostics: [] },
    bounds,
  );
  diagnostics.push(...resultDiagnostics);

  // "returns a diagnostic and no preview rather than silently truncating" (generators.md §14).
  // Cleared on both the top-level notes and the returned plan, so a caller
  // reading result.output.notes doesn't see the dropped preview reappear.
  if (resultDiagnostics.some((d) => d.code === 'max-notes-exceeded')) {
    notes = [];
    output = { ...finalOutput, notes: [] };
  }

  return { output, notes, diagnostics, trace: finalTrace };
}
