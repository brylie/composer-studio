import { describe, expect, it } from 'vitest';
import { euclideanPattern } from './euclidean.js';

describe('euclideanPattern', () => {
  it('spreads 3 pulses across 8 steps as evenly as possible at rotation 0', () => {
    // This implementation's own natural phase for E(3,8) — verified by hand
    // against the bucket algorithm, not the Bjorklund "tresillo" phase
    // (which is this same shape at a different rotation; `rotation` exists
    // precisely so a caller can dial in whichever phase they want).
    expect(euclideanPattern(8, 3, 0)).toEqual([
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      true,
    ]);
  });

  it('always emits exactly clamp(pulses, 0, steps) onsets', () => {
    for (const steps of [1, 3, 5, 8, 13, 16]) {
      for (const pulses of [-2, 0, 1, 4, 7, 20]) {
        const pattern = euclideanPattern(steps, pulses, 0);
        const expectedCount = Math.max(0, Math.min(steps, pulses));
        expect(pattern.filter(Boolean).length).toBe(expectedCount);
        expect(pattern.length).toBe(steps);
      }
    }
  });

  it('returns an empty pattern for zero steps', () => {
    expect(euclideanPattern(0, 3, 0)).toEqual([]);
  });

  it('returns all-true when pulses >= steps', () => {
    expect(euclideanPattern(4, 4, 0)).toEqual([true, true, true, true]);
    expect(euclideanPattern(4, 10, 0)).toEqual([true, true, true, true]);
  });

  it('returns all-false when pulses <= 0', () => {
    expect(euclideanPattern(4, 0, 0)).toEqual([false, false, false, false]);
    expect(euclideanPattern(4, -3, 0)).toEqual([false, false, false, false]);
  });

  it('rotation is a circular left-shift of the unrotated pattern', () => {
    const base = euclideanPattern(8, 3, 0);
    const rotated = euclideanPattern(8, 3, 3);
    const expected = base.map((_, i) => base[(i + 3) % base.length]);
    expect(rotated).toEqual(expected);
  });

  it('rotation is periodic modulo steps', () => {
    expect(euclideanPattern(8, 3, 3)).toEqual(euclideanPattern(8, 3, 11));
    expect(euclideanPattern(8, 3, -5)).toEqual(euclideanPattern(8, 3, 3));
  });

  it('is deterministic for a fixed request', () => {
    expect(euclideanPattern(8, 3, 1)).toEqual(euclideanPattern(8, 3, 1));
  });
});
