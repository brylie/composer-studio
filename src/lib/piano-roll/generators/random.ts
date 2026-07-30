// Domain layer — generator seeding (generators.md §4.5). Generator code must
// never call Math.random(); deriveSeed/createSeededRandom are the only
// permitted source of variation.

import { createSeededRandom } from '../random.js';
import type { VariationLocks, VariationState } from './types.js';

export { createSeededRandom } from '../random.js';

/**
 * FNV-1a over a stable string key. Not cryptographic — just a cheap way to
 * spread (seed, generation, ...keyParts) into a well-mixed 32-bit sub-seed.
 * Exported for reuse as session.ts's context-revision fingerprint (generators.md
 * §4.7, §12.2) — same "cheap deterministic 32-bit hash" need, different input shape.
 */
export function hashToUint32(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Length-prefixes each part before joining, so ('a:b', 'c') and ('a', 'b:c')
 * — or any other split that only differs in where a separator falls inside a
 * part — can never encode to the same string. A plain `parts.join(':')`
 * would collide on both of the above.
 */
function encodeParts(parts: (string | number)[]): string {
  return parts.map((part) => `${String(String(part).length)}:${String(part)}`).join('');
}

/**
 * Derives an independent sub-seed for one dimension of a session's seed
 * (generators.md §4.5: rhythmSeed/pitchSeed/voicingSeed) or for one node in a
 * recipe (generators.md §5 evaluator step 4). Deterministic: the same
 * (seed, generation, keyParts) always produces the same sub-seed, and
 * different keyParts produce independent sequences even for the same base
 * seed and generation.
 */
export function deriveSeed(
  seed: number,
  generation: number,
  ...keyParts: (string | number)[]
): number {
  return hashToUint32(encodeParts([seed, generation, ...keyParts]));
}

/**
 * A seeded RNG for one node's use of one VariationLocks dimension —
 * `deriveSeed(variation.seed, locked ? 0 : variation.generation, dimension, nodeId)`
 * plus `createSeededRandom`, the pattern every operator that varies by a
 * lock dimension needs (generators.md §4.5). Locking a dimension pins its
 * sub-seed's generation component to 0, so a locked reroll stays stable
 * while other, unlocked dimensions still vary.
 */
export function dimensionRandom(
  variation: VariationState,
  nodeId: string,
  dimension: keyof VariationLocks,
): () => number {
  const seed = deriveSeed(
    variation.seed,
    variation.locks[dimension] ? 0 : variation.generation,
    dimension,
    nodeId,
  );
  return createSeededRandom(seed);
}

/**
 * A stable eventKey for a generated note draft (generators.md §4.4), derived
 * from the session, node, and event position rather than a random or
 * incrementing id — repeated evaluations of the same session/node/position
 * produce the same key, which is what lets preview notes use keyed rendering
 * and scheduling without becoming document notes.
 */
export function deriveEventKey(
  sessionId: string,
  nodeId: string,
  position: number | string,
): string {
  return encodeParts([sessionId, nodeId, position]);
}
