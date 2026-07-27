import { describe, expect, it } from 'vitest';
import { commandRegistry } from './index.js';

describe('commandRegistry', () => {
  it('contains one entry per implemented command, each with a stable id', () => {
    const ids = commandRegistry.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length); // all ids unique
    expect(ids).toEqual(
      expect.arrayContaining([
        'transpose',
        'retrograde',
        'invert',
        'augmentation',
        'diminution',
        'permutation',
        'jitter',
        'generate-chords',
      ]),
    );
  });

  it('every descriptor has exactly one of run/effect', () => {
    for (const command of commandRegistry) {
      const hasRun = typeof command.run === 'function';
      const hasEffect = typeof command.effect === 'function';
      expect(hasRun !== hasEffect).toBe(true);
    }
  });
});
