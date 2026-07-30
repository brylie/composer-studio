import { describe, expect, it } from 'vitest';
import { generatorCatalog, insertableModules, pulsePatternGenerator } from './catalog.js';
import { evaluateGeneratorRecipe } from './evaluator.js';
import { operatorRegistry } from './operators.js';
import { validateRecipe } from './recipe.js';
import { makeGeneratorContext } from './test-helpers.js';

const ctx = makeGeneratorContext();

describe('pulsePatternGenerator', () => {
  it('is registered in the starter catalog', () => {
    expect(generatorCatalog).toContain(pulsePatternGenerator);
  });

  it('produces a valid, acyclic default recipe', () => {
    const recipe = pulsePatternGenerator.createDefaultRecipe(ctx);
    expect(validateRecipe(recipe, operatorRegistry)).toEqual([]);
  });

  it('evaluates to in-bounds notes with no error diagnostics', () => {
    const bounds = pulsePatternGenerator.getDefaultBounds(ctx);
    const recipe = pulsePatternGenerator.createDefaultRecipe(ctx);
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
    expect(result.diagnostics.filter((d) => d.level === 'error')).toEqual([]);
    expect(result.notes.length).toBeGreaterThan(0);
    for (const note of result.notes) {
      expect(note.midiNote).toBeGreaterThanOrEqual(bounds.pitch.minMidi);
      expect(note.midiNote).toBeLessThanOrEqual(bounds.pitch.maxMidi);
      expect(note.startBeat).toBeGreaterThanOrEqual(bounds.time.startBeat);
    }
  });

  it('every operator referenced by the default recipe is registered', () => {
    const recipe = pulsePatternGenerator.createDefaultRecipe(ctx);
    for (const node of recipe.nodes) {
      expect(operatorRegistry.has(node.operatorId)).toBe(true);
    }
  });
});

describe('insertableModules', () => {
  it('only references registered operators', () => {
    for (const mod of insertableModules) {
      expect(operatorRegistry.has(mod.operatorId)).toBe(true);
    }
  });
});

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
