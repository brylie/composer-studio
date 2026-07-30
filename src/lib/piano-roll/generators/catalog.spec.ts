import { describe, expect, it } from 'vitest';
import {
  arpeggiateGenerator,
  euclideanRhythmGenerator,
  generateChordsGenerator,
  generatorCatalog,
  insertableModules,
  motifGenerator,
  ostinatoGenerator,
  pulsePatternGenerator,
} from './catalog.js';
import { evaluateGeneratorRecipe } from './evaluator.js';
import { operatorRegistry } from './operators.js';
import { validateRecipe } from './recipe.js';
import { makeGeneratorContext } from './test-helpers.js';
import type { GeneratorContext, GeneratorDescriptor } from './types.js';

const plainCtx = makeGeneratorContext();

/**
 * generators.md §18 Phase D item 1 ("generate-chords") and item 4
 * ("ostinato-generate") default to `source: 'chord-track'`/`'active-chord'`,
 * so a bare context with no chord-track events produces a *valid* but
 * musically empty preview (generators.md §6.2 distinguishes "produced zero
 * notes" from "failed to evaluate") — not a bug, but the wrong fixture for
 * asserting "the default recipe actually generates something." Each starter
 * that needs seed context gets its own minimal context here instead.
 */
function contextFor(id: string): GeneratorContext {
  switch (id) {
    case 'generate-chords':
    case 'arpeggiate':
    case 'ostinato-generate':
      return makeGeneratorContext({
        chordTrack: [
          { id: 'c1', beat: 0, root: 0, quality: 'maj7' },
          { id: 'c2', beat: 4, root: 7, quality: '7' },
        ],
      });
    default:
      return plainCtx;
  }
}

function makeLocks() {
  return {
    rhythm: false,
    pitch: false,
    contour: false,
    register: false,
    voicing: false,
    dynamics: false,
  };
}

/** Runs a starter generator's default recipe through the real evaluator, in its own seed context. */
function evaluateDefault(descriptor: GeneratorDescriptor) {
  const ctx = contextFor(descriptor.id);
  const bounds = descriptor.getDefaultBounds(ctx);
  const recipe = descriptor.createDefaultRecipe(ctx);
  const result = evaluateGeneratorRecipe(
    ctx,
    {
      bounds,
      recipe,
      variation: { seed: 1, generation: 0, locks: makeLocks() },
      contextRevision: {},
    },
    operatorRegistry,
  );
  return { ctx, bounds, recipe, result };
}

const ALL_GENERATORS: [string, GeneratorDescriptor][] = [
  ['pulsePatternGenerator', pulsePatternGenerator],
  ['generateChordsGenerator', generateChordsGenerator],
  ['arpeggiateGenerator', arpeggiateGenerator],
  ['euclideanRhythmGenerator', euclideanRhythmGenerator],
  ['ostinatoGenerator', ostinatoGenerator],
  ['motifGenerator', motifGenerator],
];

describe.each(ALL_GENERATORS)('%s', (_name, descriptor) => {
  it('is registered in the starter catalog', () => {
    expect(generatorCatalog).toContain(descriptor);
  });

  it('produces a valid, acyclic default recipe', () => {
    const ctx = contextFor(descriptor.id);
    const recipe = descriptor.createDefaultRecipe(ctx);
    expect(validateRecipe(recipe, operatorRegistry)).toEqual([]);
  });

  it('every operator referenced by the default recipe is registered', () => {
    const ctx = contextFor(descriptor.id);
    const recipe = descriptor.createDefaultRecipe(ctx);
    for (const node of recipe.nodes) {
      expect(operatorRegistry.has(node.operatorId)).toBe(true);
    }
  });

  it('evaluates to in-bounds notes with no error diagnostics', () => {
    const { bounds, result } = evaluateDefault(descriptor);
    expect(result.diagnostics.filter((d) => d.level === 'error')).toEqual([]);
    expect(result.notes.length).toBeGreaterThan(0);
    for (const note of result.notes) {
      expect(note.midiNote).toBeGreaterThanOrEqual(bounds.pitch.minMidi);
      expect(note.midiNote).toBeLessThanOrEqual(bounds.pitch.maxMidi);
      expect(note.startBeat).toBeGreaterThanOrEqual(bounds.time.startBeat);
      expect(note.startBeat).toBeLessThan(bounds.time.endBeat);
    }
  });

  it('re-evaluating the identical recipe/bounds/variation is deeply equal (deterministic)', () => {
    // A fresh createDefaultRecipe() call mints new crypto.randomUUID() node
    // ids each time (by design — every session gets its own recipe
    // identity), so eventKeys would differ even for identical musical
    // output. Determinism is about re-evaluating the *same* recipe twice,
    // not two independently-created ones.
    const ctx = contextFor(descriptor.id);
    const bounds = descriptor.getDefaultBounds(ctx);
    const recipe = descriptor.createDefaultRecipe(ctx);
    const request = {
      bounds,
      recipe,
      variation: { seed: 1, generation: 0, locks: makeLocks() },
      contextRevision: {},
    };
    const first = evaluateGeneratorRecipe(ctx, request, operatorRegistry);
    const second = evaluateGeneratorRecipe(ctx, request, operatorRegistry);
    expect(first.notes).toEqual(second.notes);
  });
});

describe('generateChordsGenerator', () => {
  it('migrates generate-chords onto chord-source -> smooth-voicing -> event-render-notes (generators.md §18 Phase D item 1)', () => {
    const ctx = contextFor('generate-chords');
    const recipe = generateChordsGenerator.createDefaultRecipe(ctx);
    expect(recipe.nodes.map((n) => n.operatorId)).toEqual([
      'chord-source',
      'smooth-voicing',
      'event-render-notes',
    ]);
  });
});

describe('arpeggiateGenerator', () => {
  it('composes a harmony operator with a rhythm operator in one recipe (generators.md §19 acceptance criterion)', () => {
    const ctx = contextFor('arpeggiate');
    const recipe = arpeggiateGenerator.createDefaultRecipe(ctx);
    const operatorIds = recipe.nodes.map((n) => n.operatorId);
    expect(operatorIds).toContain('chord-source'); // harmony
    expect(operatorIds).toContain('euclidean-gate'); // rhythm
  });

  it('matches generators.md §8.1\'s "Arpeggio on a Euclidean rhythm" chain shape', () => {
    const ctx = contextFor('arpeggiate');
    const recipe = arpeggiateGenerator.createDefaultRecipe(ctx);
    expect(recipe.nodes.map((n) => n.operatorId)).toEqual([
      'chord-source',
      'smooth-voicing',
      'arpeggiate',
      'euclidean-gate',
      'event-render-notes',
    ]);
  });
});

describe('euclideanRhythmGenerator', () => {
  it('produces onsets following a Euclidean pulse pattern rather than a regular grid', () => {
    const { result } = evaluateDefault(euclideanRhythmGenerator);
    // Default params (8 steps, 3 pulses) shouldn't produce an onset at every step.
    const starts = result.notes.map((n) => n.startBeat);
    expect(starts.length).toBeLessThan(16); // fewer onsets than a dense 0.5-beat grid over the default span
  });
});

describe('ostinatoGenerator', () => {
  it('repeats a recognizable cell across the bounds', () => {
    const { result, bounds } = evaluateDefault(ostinatoGenerator);
    const cellLength = 2; // ostinatoGenerateOperator's default patternLengthBeats
    const repeats = Math.floor((bounds.time.endBeat - bounds.time.startBeat) / cellLength);
    expect(repeats).toBeGreaterThan(1);
    // With transposition: 'none' (the default), the first repeat's pitch
    // sequence recurs exactly at each later repeat's own offset.
    const firstCellPitches = result.notes
      .filter((n) => n.startBeat < cellLength)
      .map((n) => n.midiNote);
    const secondCellPitches = result.notes
      .filter((n) => n.startBeat >= cellLength && n.startBeat < cellLength * 2)
      .map((n) => n.midiNote);
    expect(secondCellPitches).toEqual(firstCellPitches);
  });
});

describe('motifGenerator', () => {
  it('repeats its contour cell across `repetition` cycles', () => {
    const { result } = evaluateDefault(motifGenerator);
    // motifGenerateOperator's default repetition is 2 and eventCount is 4,
    // and the default bounds/lengthBeats leave room for both repeats to
    // fully fit.
    expect(result.notes).toHaveLength(8);
  });
});

describe('insertableModules', () => {
  it('only references registered operators', () => {
    for (const mod of insertableModules) {
      expect(operatorRegistry.has(mod.operatorId)).toBe(true);
    }
  });

  it('includes every Phase D processor module usable inside a manually-composed recipe', () => {
    const ids = insertableModules.map((m) => m.operatorId);
    expect(ids).toEqual(
      expect.arrayContaining(['smooth-voicing', 'arpeggiate', 'euclidean-gate', 'transpose-notes']),
    );
  });
});
