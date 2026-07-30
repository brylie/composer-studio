// Application-facing generator catalog (generators.md §5, §7.4, §18 Phase C).
//
// A starter generator creates a new session and its default recipe
// (generators.md §7.4); a module is inserted into an already-active
// session's chain. Phase D still owns the "real" catalog named in
// generators.md §2 (arpeggiate, euclidean-rhythm, motif-generate,
// ostinato-generate, generate-chords) — pulse-pattern below is the simple,
// genre-agnostic rhythm-family generator generators.md §9.1 calls out as
// useful "both on its own and as infrastructure", used here to exercise the
// session UI end to end.

import {
  operatorRegistry,
  pulseRenderNotesOperator,
  pulseSourceOperator,
  transposeNotesOperator,
} from './operators.js';
import { autoWireSerial } from './recipe.js';
import type { GeneratorDescriptor, GeneratorNodeInstance, GeneratorRecipe } from './types.js';

const DEFAULT_SPAN_BEATS = 4;

export const pulsePatternGenerator: GeneratorDescriptor = {
  id: 'pulse-pattern',
  version: 1,
  category: 'generate',
  family: 'rhythm',
  labelKey: 'generators.pulsePattern.label',
  descriptionKey: 'generators.pulsePattern.description',
  icon: 'pulse',
  tags: ['rhythm', 'pulse'],
  isApplicable: () => true,
  getDefaultBounds(ctx) {
    const startBeat = Math.max(0, Math.floor(ctx.playhead));
    return {
      time: { startBeat, endBeat: startBeat + DEFAULT_SPAN_BEATS },
      pitch: { minMidi: 48, maxMidi: 84 },
      allowTail: false,
    };
  },
  createDefaultRecipe(ctx): GeneratorRecipe {
    const sourceNode: GeneratorNodeInstance = {
      id: crypto.randomUUID(),
      operatorId: pulseSourceOperator.id,
      operatorVersion: pulseSourceOperator.version,
      params: pulseSourceOperator.getDefaultParams(ctx),
      enabled: true,
    };
    const rendererNode: GeneratorNodeInstance = {
      id: crypto.randomUUID(),
      operatorId: pulseRenderNotesOperator.id,
      operatorVersion: pulseRenderNotesOperator.version,
      params: pulseRenderNotesOperator.getDefaultParams(ctx),
      enabled: true,
    };
    const nodes = [sourceNode, rendererNode];
    const { edges } = autoWireSerial(nodes, operatorRegistry);
    return {
      id: crypto.randomUUID(),
      version: 1,
      nodes,
      edges,
      output: { nodeId: rendererNode.id, port: 'notes' },
    };
  },
};

/** Every starter generator offered by the browser (generators.md §7.4). */
export const generatorCatalog: GeneratorDescriptor[] = [pulsePatternGenerator];

export interface InsertableModule {
  operatorId: string;
  label: string;
}

/** Modules the inspector's "Add module" action can append to an active session's chain (generators.md §7.4). */
export const insertableModules: InsertableModule[] = [
  { operatorId: transposeNotesOperator.id, label: transposeNotesOperator.label },
];
