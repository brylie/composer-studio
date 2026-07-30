import { describe, expect, it } from 'vitest';
import { deriveEventKey, deriveSeed, dimensionRandom } from './random.js';
import { makeVariation } from './test-helpers.js';

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

  it('does not collide when a separator falls at a different point inside a key part', () => {
    // A plain ':'-joined key would encode both of these as "1:0:a:b:c".
    expect(deriveSeed(1, 0, 'a:b', 'c')).not.toBe(deriveSeed(1, 0, 'a', 'b:c'));
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

  it('does not collide when a separator falls at a different point inside a part', () => {
    // A plain ':'-joined key would encode both of these as "a:b:c:0".
    expect(deriveEventKey('a:b', 'c', 0)).not.toBe(deriveEventKey('a', 'b:c', 0));
  });
});

describe('dimensionRandom', () => {
  it('is deterministic for the same variation/nodeId/dimension', () => {
    const variation = makeVariation({ generation: 2 });
    expect(dimensionRandom(variation, 'node', 'pitch')()).toBe(
      dimensionRandom(variation, 'node', 'pitch')(),
    );
  });

  it('varies across generations when the dimension is unlocked', () => {
    const first = dimensionRandom(makeVariation({ generation: 0 }), 'node', 'pitch')();
    const second = dimensionRandom(makeVariation({ generation: 1 }), 'node', 'pitch')();
    expect(first).not.toBe(second);
  });

  it('stays stable across generations when the dimension is locked', () => {
    const locks = { ...makeVariation().locks, pitch: true };
    const first = dimensionRandom(makeVariation({ generation: 0, locks }), 'node', 'pitch')();
    const second = dimensionRandom(makeVariation({ generation: 1, locks }), 'node', 'pitch')();
    expect(first).toBe(second);
  });

  it('locking one dimension does not affect an unlocked dimension varying by generation', () => {
    const locks = { ...makeVariation().locks, pitch: true };
    const first = dimensionRandom(makeVariation({ generation: 0, locks }), 'node', 'contour')();
    const second = dimensionRandom(makeVariation({ generation: 1, locks }), 'node', 'contour')();
    expect(first).not.toBe(second);
  });

  it('produces independent sequences per dimension for the same variation/nodeId', () => {
    const variation = makeVariation();
    const pitch = dimensionRandom(variation, 'node', 'pitch')();
    const rhythm = dimensionRandom(variation, 'node', 'rhythm')();
    expect(pitch).not.toBe(rhythm);
  });

  it('produces independent sequences per nodeId for the same variation/dimension', () => {
    const variation = makeVariation();
    const a = dimensionRandom(variation, 'node-a', 'pitch')();
    const b = dimensionRandom(variation, 'node-b', 'pitch')();
    expect(a).not.toBe(b);
  });
});
