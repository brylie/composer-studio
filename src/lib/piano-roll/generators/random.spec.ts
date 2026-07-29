import { describe, expect, it } from 'vitest';
import { deriveEventKey, deriveSeed } from './random.js';

describe('deriveSeed', () => {
  it('is deterministic for the same inputs', () => {
    expect(deriveSeed(42, 3, 'rhythm')).toBe(deriveSeed(42, 3, 'rhythm'));
  });

  it('produces independent sub-seeds per dimension', () => {
    const rhythm = deriveSeed(42, 0, 'rhythm');
    const pitch = deriveSeed(42, 0, 'pitch');
    const voicing = deriveSeed(42, 0, 'voicing');
    expect(new Set([rhythm, pitch, voicing]).size).toBe(3);
  });

  it('changes when the base seed changes', () => {
    expect(deriveSeed(1, 0, 'rhythm')).not.toBe(deriveSeed(2, 0, 'rhythm'));
  });

  it('changes when the generation changes', () => {
    expect(deriveSeed(1, 0, 'rhythm')).not.toBe(deriveSeed(1, 1, 'rhythm'));
  });

  it('changes per node id, for evaluator per-node sub-seeds', () => {
    expect(deriveSeed(1, 0, 'node-a')).not.toBe(deriveSeed(1, 0, 'node-b'));
  });

  it('always returns a non-negative 32-bit integer', () => {
    for (let i = 0; i < 20; i++) {
      const seed = deriveSeed(i, i * 7, 'x', i);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(2 ** 32);
    }
  });
});

describe('deriveEventKey', () => {
  it('is stable for the same session/node/position', () => {
    expect(deriveEventKey('session-1', 'node-1', 0)).toBe(deriveEventKey('session-1', 'node-1', 0));
  });

  it('differs by session, node, or position', () => {
    const base = deriveEventKey('session-1', 'node-1', 0);
    expect(deriveEventKey('session-2', 'node-1', 0)).not.toBe(base);
    expect(deriveEventKey('session-1', 'node-2', 0)).not.toBe(base);
    expect(deriveEventKey('session-1', 'node-1', 1)).not.toBe(base);
  });
});
