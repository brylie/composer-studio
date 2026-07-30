import { describe, expect, it } from 'vitest';
import { makeNote } from '../commands/test-helpers.js';
import { ostinatoGenerateOperator } from './operators-ostinato.js';
import { makeBounds, makeGeneratorContext, makeVariation } from './test-helpers.js';
import type { NotePlan, OperatorRequest } from './types.js';

function request(overrides: Partial<OperatorRequest> = {}): OperatorRequest {
  return {
    bounds: makeBounds({ time: { startBeat: 0, endBeat: 8 } }),
    params: {},
    variation: makeVariation(),
    nodeId: 'node',
    ...overrides,
  };
}

describe('ostinatoGenerateOperator', () => {
  it('repeats a cell derived from the active chord `repeats` times', () => {
    const ctx = makeGeneratorContext({
      chordTrack: [{ id: 'c1', beat: 0, root: 0, quality: 'maj' }],
    });
    const result = ostinatoGenerateOperator.process(
      ctx,
      {},
      request({
        params: {
          source: 'active-chord',
          patternLengthBeats: 2,
          repeats: 4,
          transposition: 'none',
        },
      }),
    );
    const plan = result.notes as NotePlan;
    expect(plan.notes.length).toBeGreaterThan(0);
    // Every repeat's first note starts exactly on a patternLengthBeats-aligned beat.
    const patternLengthBeats = 2;
    for (let repeatStart = 0; repeatStart < 8; repeatStart += patternLengthBeats) {
      const firstNoteInRepeat = plan.notes
        .filter((n) => n.startBeat >= repeatStart && n.startBeat < repeatStart + patternLengthBeats)
        .reduce((min, n) => Math.min(min, n.startBeat), Infinity);
      expect(firstNoteInRepeat).toBe(repeatStart);
    }
  });

  it('repeats the selection when source is selection', () => {
    const ctx = makeGeneratorContext({
      allNotes: [
        makeNote({ id: 'a', startBeat: 4, midiNote: 60, durationBeats: 0.5 }),
        makeNote({ id: 'b', startBeat: 4.5, midiNote: 64, durationBeats: 0.5 }),
      ],
      selectedIds: new Set(['a', 'b']),
    });
    const result = ostinatoGenerateOperator.process(
      ctx,
      {},
      request({ params: { source: 'selection', patternLengthBeats: 1, repeats: 3 } }),
    );
    const plan = result.notes as NotePlan;
    // Two notes per repeat × 3 repeats.
    expect(plan.notes).toHaveLength(6);
    // Normalized to start at offset 0 regardless of the selection's own beat.
    expect(plan.notes[0].startBeat).toBe(0);
  });

  it('produces an empty note plan when the source has nothing to draw from', () => {
    const ctx = makeGeneratorContext(); // no chord track, no scale track, no selection
    const result = ostinatoGenerateOperator.process(
      ctx,
      {},
      request({ params: { source: 'active-chord', patternLengthBeats: 2, repeats: 4 } }),
    );
    expect((result.notes as NotePlan).notes).toEqual([]);
  });

  it('never produces a note starting outside the time bounds', () => {
    const ctx = makeGeneratorContext({
      chordTrack: [{ id: 'c1', beat: 0, root: 0, quality: 'maj7' }],
    });
    const bounds = makeBounds({ time: { startBeat: 0, endBeat: 5 } });
    const result = ostinatoGenerateOperator.process(
      ctx,
      {},
      request({ bounds, params: { source: 'active-chord', patternLengthBeats: 2, repeats: 10 } }),
    );
    for (const note of (result.notes as NotePlan).notes) {
      expect(note.startBeat).toBeGreaterThanOrEqual(0);
      expect(note.startBeat).toBeLessThan(5);
    }
  });

  it('transposes each repeat when following the chord root, unlike transposition: none', () => {
    const chordTrack = [
      { id: 'c1', beat: 0, root: 0, quality: 'maj' },
      { id: 'c2', beat: 2, root: 5, quality: 'maj' },
    ];
    const ctx = makeGeneratorContext({ chordTrack });
    const baseParams = { source: 'active-chord', patternLengthBeats: 2, repeats: 2 };

    const untransposed = ostinatoGenerateOperator.process(
      ctx,
      {},
      request({ params: { ...baseParams, transposition: 'none' } }),
    );
    const followed = ostinatoGenerateOperator.process(
      ctx,
      {},
      request({ params: { ...baseParams, transposition: 'follow-chord-root' } }),
    );

    const secondRepeatUntransposed = (untransposed.notes as NotePlan).notes
      .filter((n) => n.startBeat >= 2)
      .map((n) => n.midiNote);
    const secondRepeatFollowed = (followed.notes as NotePlan).notes
      .filter((n) => n.startBeat >= 2)
      .map((n) => n.midiNote);

    expect(secondRepeatUntransposed.length).toBeGreaterThan(0);
    expect(secondRepeatFollowed).not.toEqual(secondRepeatUntransposed);
  });

  it('is deterministic for a fixed request', () => {
    const ctx = makeGeneratorContext({
      chordTrack: [{ id: 'c1', beat: 0, root: 0, quality: 'maj7' }],
    });
    const req = request({ params: { source: 'active-chord', patternLengthBeats: 2, repeats: 4 } });
    expect(ostinatoGenerateOperator.process(ctx, {}, req)).toEqual(
      ostinatoGenerateOperator.process(ctx, {}, req),
    );
  });

  it('varies pitch across an unlocked reroll when variation is configured', () => {
    const ctx = makeGeneratorContext({
      chordTrack: [{ id: 'c1', beat: 0, root: 0, quality: 'maj7' }],
    });
    const params = {
      source: 'active-chord',
      patternLengthBeats: 2,
      repeats: 4,
      variationEvery: 1,
      variationAmount: 5,
    };
    const first = ostinatoGenerateOperator.process(
      ctx,
      {},
      request({ params, variation: makeVariation({ generation: 0 }) }),
    );
    const second = ostinatoGenerateOperator.process(
      ctx,
      {},
      request({ params, variation: makeVariation({ generation: 1 }) }),
    );
    expect((first.notes as NotePlan).notes.map((n) => n.midiNote)).not.toEqual(
      (second.notes as NotePlan).notes.map((n) => n.midiNote),
    );
  });

  it('keeps pitch stable across a reroll when the pitch dimension is locked', () => {
    const ctx = makeGeneratorContext({
      chordTrack: [{ id: 'c1', beat: 0, root: 0, quality: 'maj7' }],
    });
    const params = {
      source: 'active-chord',
      patternLengthBeats: 2,
      repeats: 4,
      variationEvery: 1,
      variationAmount: 5,
    };
    const locks = { ...makeVariation().locks, pitch: true };
    const first = ostinatoGenerateOperator.process(
      ctx,
      {},
      request({ params, variation: makeVariation({ generation: 0, locks }) }),
    );
    const second = ostinatoGenerateOperator.process(
      ctx,
      {},
      request({ params, variation: makeVariation({ generation: 1, locks }) }),
    );
    expect((first.notes as NotePlan).notes.map((n) => n.midiNote)).toEqual(
      (second.notes as NotePlan).notes.map((n) => n.midiNote),
    );
  });
});
