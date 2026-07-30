import { describe, expect, it } from 'vitest';
import { makeNote } from '../commands/test-helpers.js';
import { motifGenerateOperator } from './operators-motif.js';
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

describe('motifGenerateOperator', () => {
  it('produces eventCount × repetition notes for a deterministic contour', () => {
    const ctx = makeGeneratorContext({
      scaleTrack: [{ id: 's1', beat: 0, root: 0, mode: 'major' }],
    });
    const result = motifGenerateOperator.process(
      ctx,
      {},
      request({
        params: {
          source: 'active-scale',
          lengthBeats: 2,
          eventCount: 4,
          contour: 'ascending',
          maxLeapSemitones: 12,
          repetition: 2,
          variationAmount: 0,
        },
      }),
    );
    const plan = result.notes as NotePlan;
    expect(plan.notes).toHaveLength(8);
  });

  it('falls back to the arch contour for an unrecognized contour value instead of producing an empty plan', () => {
    const ctx = makeGeneratorContext({
      scaleTrack: [{ id: 's1', beat: 0, root: 0, mode: 'major' }],
    });
    const baseParams = {
      source: 'active-scale',
      lengthBeats: 2,
      eventCount: 4,
      maxLeapSemitones: 12,
      repetition: 1,
      variationAmount: 0,
    };
    const archResult = motifGenerateOperator.process(
      ctx,
      {},
      request({ params: { ...baseParams, contour: 'arch' } }),
    );
    const malformedResult = motifGenerateOperator.process(
      ctx,
      {},
      request({ params: { ...baseParams, contour: 'not-a-real-contour' } }),
    );
    expect((malformedResult.notes as NotePlan).notes).toEqual((archResult.notes as NotePlan).notes);
  });

  it('every note stays within the requested pitch bounds', () => {
    const ctx = makeGeneratorContext({
      scaleTrack: [{ id: 's1', beat: 0, root: 0, mode: 'major' }],
    });
    const bounds = makeBounds({
      time: { startBeat: 0, endBeat: 8 },
      pitch: { minMidi: 60, maxMidi: 72 },
    });
    const result = motifGenerateOperator.process(
      ctx,
      {},
      request({
        bounds,
        params: {
          source: 'active-scale',
          lengthBeats: 2,
          eventCount: 6,
          contour: 'arch',
          maxLeapSemitones: 12,
          repetition: 2,
          variationAmount: 0,
        },
      }),
    );
    for (const note of (result.notes as NotePlan).notes) {
      expect(note.midiNote).toBeGreaterThanOrEqual(60);
      expect(note.midiNote).toBeLessThanOrEqual(72);
    }
  });

  it('constrains consecutive leaps to maxLeapSemitones', () => {
    const ctx = makeGeneratorContext({
      scaleTrack: [{ id: 's1', beat: 0, root: 0, mode: 'major' }],
    });
    const result = motifGenerateOperator.process(
      ctx,
      {},
      request({
        params: {
          source: 'active-scale',
          lengthBeats: 4,
          eventCount: 8,
          contour: 'mixed',
          maxLeapSemitones: 3,
          repetition: 1,
          variationAmount: 0,
        },
      }),
    );
    const notes = (result.notes as NotePlan).notes;
    for (let i = 1; i < notes.length; i++) {
      expect(Math.abs(notes[i].midiNote - notes[i - 1].midiNote)).toBeLessThanOrEqual(3);
    }
  });

  it('anchors on the selection mean pitch when source is selection-derived', () => {
    const ctx = makeGeneratorContext({
      allNotes: [
        makeNote({ id: 'a', startBeat: 0, midiNote: 72 }),
        makeNote({ id: 'b', startBeat: 1, midiNote: 74 }),
      ],
      selectedIds: new Set(['a', 'b']),
    });
    const result = motifGenerateOperator.process(
      ctx,
      {},
      request({
        params: {
          source: 'selection-derived',
          lengthBeats: 2,
          eventCount: 4,
          contour: 'ascending',
          maxLeapSemitones: 12,
          repetition: 1,
          variationAmount: 0,
        },
      }),
    );
    const notes = (result.notes as NotePlan).notes;
    expect(notes.length).toBeGreaterThan(0);
    // The first (lowest-degree) note should land near the selection's own
    // register (mean ~73), not the default bounds-center anchor.
    expect(notes[0].midiNote).toBeGreaterThan(65);
  });

  it('is deterministic for a fixed request with variationAmount 0', () => {
    const ctx = makeGeneratorContext({
      scaleTrack: [{ id: 's1', beat: 0, root: 0, mode: 'major' }],
    });
    const req = request({
      params: {
        source: 'active-scale',
        lengthBeats: 2,
        eventCount: 4,
        contour: 'arch',
        maxLeapSemitones: 12,
        repetition: 2,
        variationAmount: 0,
      },
    });
    expect(motifGenerateOperator.process(ctx, {}, req)).toEqual(
      motifGenerateOperator.process(ctx, {}, req),
    );
  });

  it('varies contour shape across an unlocked reroll for the "mixed" contour', () => {
    const ctx = makeGeneratorContext({
      scaleTrack: [{ id: 's1', beat: 0, root: 0, mode: 'major' }],
    });
    const params = {
      source: 'active-scale',
      lengthBeats: 2,
      eventCount: 6,
      contour: 'mixed',
      maxLeapSemitones: 12,
      repetition: 1,
      variationAmount: 0,
    };
    const first = motifGenerateOperator.process(
      ctx,
      {},
      request({ params, variation: makeVariation({ generation: 0 }) }),
    );
    const second = motifGenerateOperator.process(
      ctx,
      {},
      request({ params, variation: makeVariation({ generation: 1 }) }),
    );
    expect((first.notes as NotePlan).notes.map((n) => n.midiNote)).not.toEqual(
      (second.notes as NotePlan).notes.map((n) => n.midiNote),
    );
  });

  it('keeps contour stable across a reroll when the contour dimension is locked', () => {
    const ctx = makeGeneratorContext({
      scaleTrack: [{ id: 's1', beat: 0, root: 0, mode: 'major' }],
    });
    const params = {
      source: 'active-scale',
      lengthBeats: 2,
      eventCount: 6,
      contour: 'mixed',
      maxLeapSemitones: 12,
      repetition: 1,
      variationAmount: 0,
    };
    const locks = { ...makeVariation().locks, contour: true };
    const first = motifGenerateOperator.process(
      ctx,
      {},
      request({ params, variation: makeVariation({ generation: 0, locks }) }),
    );
    const second = motifGenerateOperator.process(
      ctx,
      {},
      request({ params, variation: makeVariation({ generation: 1, locks }) }),
    );
    expect((first.notes as NotePlan).notes.map((n) => n.midiNote)).toEqual(
      (second.notes as NotePlan).notes.map((n) => n.midiNote),
    );
  });

  it('never produces a note starting outside the time bounds', () => {
    const ctx = makeGeneratorContext({
      scaleTrack: [{ id: 's1', beat: 0, root: 0, mode: 'major' }],
    });
    const bounds = makeBounds({ time: { startBeat: 0, endBeat: 3 } });
    const result = motifGenerateOperator.process(
      ctx,
      {},
      request({
        bounds,
        params: {
          source: 'active-scale',
          lengthBeats: 2,
          eventCount: 4,
          contour: 'arch',
          maxLeapSemitones: 12,
          repetition: 5,
          variationAmount: 0,
        },
      }),
    );
    for (const note of (result.notes as NotePlan).notes) {
      expect(note.startBeat).toBeGreaterThanOrEqual(0);
      expect(note.startBeat).toBeLessThan(3);
    }
  });
});
