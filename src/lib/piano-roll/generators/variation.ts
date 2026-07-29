// Domain layer — compact reroll checkpoints (generators.md §6, §6.4).
//
// Rerolling must not flood document undo/redo with generated-note snapshots:
// a checkpoint stores only seed/generation/randomizedParams, never the
// evaluated notes themselves, and history is bounded so it stays
// session-local and cheap.

import type { VariationCheckpoint, VariationState } from './types.js';

export function createCheckpoint(
  variation: VariationState,
  randomizedParams?: Record<string, unknown>,
): VariationCheckpoint {
  return randomizedParams
    ? { seed: variation.seed, generation: variation.generation, randomizedParams }
    : { seed: variation.seed, generation: variation.generation };
}

/** generators.md §6's GeneratorSessionHistory — bounded, session-local reroll history. */
export interface GeneratorSessionHistory {
  checkpoints: VariationCheckpoint[];
  index: number;
  limit: number;
}

export const DEFAULT_CHECKPOINT_LIMIT = 20;

export function createSessionHistory(limit = DEFAULT_CHECKPOINT_LIMIT): GeneratorSessionHistory {
  return { checkpoints: [], index: -1, limit };
}

/**
 * Appends a checkpoint after the current position, discarding any forward
 * ("redo") checkpoints past it — the same branch-on-write behavior as
 * ordinary undo/redo stacks. Drops the oldest checkpoints once `limit` is
 * exceeded.
 */
export function pushCheckpoint(
  history: GeneratorSessionHistory,
  checkpoint: VariationCheckpoint,
): GeneratorSessionHistory {
  const kept = history.checkpoints.slice(0, history.index + 1);
  const appended = [...kept, checkpoint];
  const overflow = Math.max(0, appended.length - history.limit);
  const checkpoints = appended.slice(overflow);
  return { checkpoints, index: checkpoints.length - 1, limit: history.limit };
}

export function previousCheckpoint(history: GeneratorSessionHistory): GeneratorSessionHistory {
  return history.index > 0 ? { ...history, index: history.index - 1 } : history;
}

export function nextCheckpoint(history: GeneratorSessionHistory): GeneratorSessionHistory {
  return history.index < history.checkpoints.length - 1
    ? { ...history, index: history.index + 1 }
    : history;
}

export function currentCheckpoint(history: GeneratorSessionHistory): VariationCheckpoint | null {
  return history.checkpoints[history.index] ?? null;
}
