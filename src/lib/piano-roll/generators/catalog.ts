// Application-facing generator catalog (generators.md §5, §7.4, §18 Phases
// C-D).
//
// A starter generator creates a new session and its default recipe
// (generators.md §7.4); a module is inserted into an already-active
// session's chain. pulse-pattern (Phase C) is the simple, genre-agnostic
// rhythm-family generator generators.md §9.1 calls out as useful "both on
// its own and as infrastructure". The remaining five starters are Phase D's
// migrated/implemented catalog named in generators.md §2 (generate-chords,
// arpeggiate, euclidean-rhythm, ostinato-generate, motif-generate).

import { arpeggiateOperator } from './operators-arpeggiate.js';
import {
  chordSourceOperator,
  eventRenderNotesOperator,
  smoothVoicingOperator,
} from './operators-harmony.js';
import { motifGenerateOperator } from './operators-motif.js';
import { ostinatoGenerateOperator } from './operators-ostinato.js';
import { euclideanGateOperator, euclideanSourceOperator } from './operators-rhythm.js';
import {
  operatorRegistry,
  pulseRenderNotesOperator,
  pulseSourceOperator,
  transposeNotesOperator,
} from './operators.js';
import { autoWireSerial } from './recipe.js';
import type {
  GeneratorContext,
  GeneratorDescriptor,
  GeneratorNodeInstance,
  GeneratorOperatorDescriptor,
  GeneratorRecipe,
} from './types.js';

const DEFAULT_SPAN_BEATS = 4;

/** A default-params node for `operator`, reducing repetition across every multi-node default recipe below. */
function makeNode(
  operator: GeneratorOperatorDescriptor,
  ctx: GeneratorContext,
): GeneratorNodeInstance {
  return {
    id: crypto.randomUUID(),
    operatorId: operator.id,
    operatorVersion: operator.version,
    params: operator.getDefaultParams(ctx),
    enabled: true,
  };
}

/** Chains `nodes` serially via autoWireSerial and returns a complete recipe outputting the last node's `outputPort`. */
function serialRecipe(nodes: GeneratorNodeInstance[], outputPort: string): GeneratorRecipe {
  const { edges } = autoWireSerial(nodes, operatorRegistry);
  return {
    id: crypto.randomUUID(),
    version: 1,
    nodes,
    edges,
    output: { nodeId: nodes[nodes.length - 1].id, port: outputPort },
  };
}

/** A `getDefaultBounds` starting at the playhead, spanning `spanBeats` (default 4), over a fixed `pitch` range. */
function makeDefaultBounds(
  pitch: { minMidi: number; maxMidi: number },
  spanBeats: number = DEFAULT_SPAN_BEATS,
): GeneratorDescriptor['getDefaultBounds'] {
  return (ctx) => {
    const startBeat = Math.max(0, Math.floor(ctx.playhead));
    return {
      time: { startBeat, endBeat: startBeat + spanBeats },
      pitch,
      allowTail: false,
    };
  };
}

const DEFAULT_HARMONY_PITCH = makeDefaultBounds({ minMidi: 48, maxMidi: 84 });

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
  getDefaultBounds: DEFAULT_HARMONY_PITCH,
  createDefaultRecipe(ctx): GeneratorRecipe {
    const nodes = [makeNode(pulseSourceOperator, ctx), makeNode(pulseRenderNotesOperator, ctx)];
    return serialRecipe(nodes, 'notes');
  },
};

/**
 * generate-chords, migrated onto the shared recipe/operator infrastructure
 * (generators.md §9.6, §18 Phase D item 1): chord-source (harmony) ->
 * smooth-voicing (voicing) -> event-render-notes (note renderer) — the
 * exact three operator roles §18 names.
 */
export const generateChordsGenerator: GeneratorDescriptor = {
  id: 'generate-chords',
  version: 1,
  category: 'generate',
  family: 'voicing',
  labelKey: 'generators.generateChords.label',
  descriptionKey: 'generators.generateChords.description',
  icon: 'chord',
  tags: ['harmony', 'voicing', 'chords'],
  isApplicable: () => true,
  getDefaultBounds: DEFAULT_HARMONY_PITCH,
  createDefaultRecipe(ctx): GeneratorRecipe {
    const nodes = [
      makeNode(chordSourceOperator, ctx),
      makeNode(smoothVoicingOperator, ctx),
      makeNode(eventRenderNotesOperator, ctx),
    ];
    return serialRecipe(nodes, 'notes');
  },
};

/**
 * Arpeggiate (generators.md §9.4, §18 Phase D item 2), wired exactly as
 * §8.1's "Arpeggio on a Euclidean rhythm" composition example: chord-source
 * -> smooth-voicing -> arpeggiate -> euclidean-gate -> event-render-notes.
 * Demonstrates a harmony operator composed with a rhythm operator in one
 * recipe (generators.md §19's acceptance criterion).
 */
export const arpeggiateGenerator: GeneratorDescriptor = {
  id: 'arpeggiate',
  version: 1,
  category: 'generate',
  family: 'arpeggio',
  labelKey: 'generators.arpeggiate.label',
  descriptionKey: 'generators.arpeggiate.description',
  icon: 'arpeggio',
  tags: ['arpeggio', 'harmony', 'rhythm'],
  isApplicable: () => true,
  getDefaultBounds: DEFAULT_HARMONY_PITCH,
  createDefaultRecipe(ctx): GeneratorRecipe {
    const nodes = [
      makeNode(chordSourceOperator, ctx),
      makeNode(smoothVoicingOperator, ctx),
      makeNode(arpeggiateOperator, ctx),
      makeNode(euclideanGateOperator, ctx),
      makeNode(eventRenderNotesOperator, ctx),
    ];
    return serialRecipe(nodes, 'notes');
  },
};

/**
 * euclidean-rhythm (generators.md §9.1, §18 Phase D item 3): a Euclidean
 * onset source rendered through the same pulse-render-notes renderer
 * pulse-pattern already uses (single fixed pitch per onset).
 */
export const euclideanRhythmGenerator: GeneratorDescriptor = {
  id: 'euclidean-rhythm',
  version: 1,
  category: 'generate',
  family: 'rhythm',
  labelKey: 'generators.euclideanRhythm.label',
  descriptionKey: 'generators.euclideanRhythm.description',
  icon: 'pulse',
  tags: ['rhythm', 'euclidean'],
  isApplicable: () => true,
  getDefaultBounds: makeDefaultBounds({ minMidi: 36, maxMidi: 84 }),
  createDefaultRecipe(ctx): GeneratorRecipe {
    const nodes = [makeNode(euclideanSourceOperator, ctx), makeNode(pulseRenderNotesOperator, ctx)];
    return serialRecipe(nodes, 'notes');
  },
};

/** ostinato-generate (generators.md §9.8, §18 Phase D item 4): a single self-contained repeating-cell operator. */
export const ostinatoGenerator: GeneratorDescriptor = {
  id: 'ostinato-generate',
  version: 1,
  category: 'generate',
  family: 'ostinato',
  labelKey: 'generators.ostinato.label',
  descriptionKey: 'generators.ostinato.description',
  icon: 'repeat',
  tags: ['ostinato', 'repetition'],
  isApplicable: () => true,
  getDefaultBounds: makeDefaultBounds({ minMidi: 36, maxMidi: 84 }, 8),
  createDefaultRecipe(ctx): GeneratorRecipe {
    return serialRecipe([makeNode(ostinatoGenerateOperator, ctx)], 'notes');
  },
};

/** motif-generate (generators.md §9.3, §18 Phase D item 5): a single self-contained contour-cell operator. */
export const motifGenerator: GeneratorDescriptor = {
  id: 'motif-generate',
  version: 1,
  category: 'generate',
  family: 'motif',
  labelKey: 'generators.motif.label',
  descriptionKey: 'generators.motif.description',
  icon: 'motif',
  tags: ['motif', 'melody'],
  isApplicable: () => true,
  getDefaultBounds: DEFAULT_HARMONY_PITCH,
  createDefaultRecipe(ctx): GeneratorRecipe {
    return serialRecipe([makeNode(motifGenerateOperator, ctx)], 'notes');
  },
};

/** Every starter generator offered by the browser (generators.md §7.4). */
export const generatorCatalog: GeneratorDescriptor[] = [
  pulsePatternGenerator,
  generateChordsGenerator,
  arpeggiateGenerator,
  euclideanRhythmGenerator,
  ostinatoGenerator,
  motifGenerator,
];

export interface InsertableModule {
  operatorId: string;
  label: string;
}

/** Modules the inspector's "Add module" action can append to an active session's chain (generators.md §7.4). */
export const insertableModules: InsertableModule[] = [
  { operatorId: transposeNotesOperator.id, label: transposeNotesOperator.label },
  { operatorId: smoothVoicingOperator.id, label: smoothVoicingOperator.label },
  { operatorId: arpeggiateOperator.id, label: arpeggiateOperator.label },
  { operatorId: euclideanGateOperator.id, label: euclideanGateOperator.label },
];
