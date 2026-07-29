import { describe, expect, it } from 'vitest';
import { makeVariation } from './test-helpers.js';
import {
  createCheckpoint,
  createSessionHistory,
  currentCheckpoint,
  nextCheckpoint,
  previousCheckpoint,
  pushCheckpoint,
} from './variation.js';

describe('createCheckpoint', () => {
  it('stores only seed and generation when nothing was randomized', () => {
    const checkpoint = createCheckpoint(makeVariation({ seed: 5, generation: 2 }));
    expect(checkpoint).toEqual({ seed: 5, generation: 2 });
  });

  it('includes randomizedParams when given', () => {
    const checkpoint = createCheckpoint(makeVariation({ seed: 5, generation: 2 }), {
      density: 0.5,
    });
    expect(checkpoint).toEqual({ seed: 5, generation: 2, randomizedParams: { density: 0.5 } });
  });
});

describe('session history', () => {
  it('starts empty', () => {
    const history = createSessionHistory();
    expect(history.checkpoints).toEqual([]);
    expect(currentCheckpoint(history)).toBeNull();
  });

  it('pushes checkpoints and tracks the current one', () => {
    let history = createSessionHistory();
    history = pushCheckpoint(history, { seed: 1, generation: 0 });
    history = pushCheckpoint(history, { seed: 2, generation: 1 });
    expect(currentCheckpoint(history)).toEqual({ seed: 2, generation: 1 });
    expect(history.checkpoints).toHaveLength(2);
  });

  it('navigates previous/next without losing history', () => {
    let history = createSessionHistory();
    history = pushCheckpoint(history, { seed: 1, generation: 0 });
    history = pushCheckpoint(history, { seed: 2, generation: 1 });
    history = previousCheckpoint(history);
    expect(currentCheckpoint(history)).toEqual({ seed: 1, generation: 0 });
    history = nextCheckpoint(history);
    expect(currentCheckpoint(history)).toEqual({ seed: 2, generation: 1 });
  });

  it('clamps previous/next at the history bounds', () => {
    let history = createSessionHistory();
    history = pushCheckpoint(history, { seed: 1, generation: 0 });
    expect(previousCheckpoint(previousCheckpoint(history))).toEqual(previousCheckpoint(history));
    expect(nextCheckpoint(nextCheckpoint(history))).toEqual(nextCheckpoint(history));
  });

  it('discards forward history when pushing after navigating back (undo/redo branch-on-write)', () => {
    let history = createSessionHistory();
    history = pushCheckpoint(history, { seed: 1, generation: 0 });
    history = pushCheckpoint(history, { seed: 2, generation: 1 });
    history = previousCheckpoint(history);
    history = pushCheckpoint(history, { seed: 3, generation: 1 });
    expect(history.checkpoints).toEqual([
      { seed: 1, generation: 0 },
      { seed: 3, generation: 1 },
    ]);
    expect(currentCheckpoint(history)).toEqual({ seed: 3, generation: 1 });
  });

  it('drops the oldest checkpoints once the bounded limit is exceeded', () => {
    let history = createSessionHistory(3);
    for (let i = 0; i < 5; i++) {
      history = pushCheckpoint(history, { seed: i, generation: i });
    }
    expect(history.checkpoints).toHaveLength(3);
    expect(history.checkpoints.map((c) => c.seed)).toEqual([2, 3, 4]);
    expect(currentCheckpoint(history)).toEqual({ seed: 4, generation: 4 });
  });
});
