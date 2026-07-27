// Domain layer — plain TS, zero Svelte/DOM imports (architecture.md).

/**
 * Deterministic PRNG (mulberry32) — the same seed always produces the same
 * sequence, so `permutation`/`jitter` commands (transformations.md) are
 * reproducible given a `seed` param, unlike `Math.random()`.
 */
export function createSeededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return function random(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
