import { describe, expect, it } from 'vitest';
import {
  pulseRenderNotesOperator,
  pulseSourceOperator,
  transposeNotesOperator,
} from './operators.js';
import { makeBounds, makeGeneratorContext, makeVariation } from './test-helpers.js';
import type { NotePlan, OperatorRequest, RhythmPlan } from './types.js';

const ctx = makeGeneratorContext();

function pulseRequest(overrides: Partial<OperatorRequest> = {}): OperatorRequest {
  return {
    bounds: makeBounds(),
    params: {},
    variation: makeVariation(),
    nodeId: 'source',
    ...overrides,
  };
}

describe('pulseSourceOperator', () => {
  it('produces one onset per step across the time bounds by default', () => {
    const bounds = makeBounds({ time: { startBeat: 0, endBeat: 4 } });
    const result = pulseSourceOperator.process(ctx, {}, pulseRequest({ bounds }));
    const plan = result.rhythm as RhythmPlan;
    expect(plan.events).toHaveLength(4); // stepBeats default 1, gate 0.8 → 4 onsets across 4 beats
    expect(plan.events.map((e) => e.startBeat)).toEqual([0, 1, 2, 3]);
    for (const event of plan.events) {
      expect(event.durationBeats).toBeCloseTo(0.8);
    }
  });

  it('is deterministic for a fixed request', () => {
    const request = pulseRequest({ params: { restProbability: 0.5 } });
    const a = pulseSourceOperator.process(ctx, {}, request);
    const b = pulseSourceOperator.process(ctx, {}, request);
    expect(a).toEqual(b);
  });

  it('varies rest placement across an unlocked reroll', () => {
    // A wide bounds range gives many steps, so a coincidental identical
    // rest pattern between the two generations is vanishingly unlikely.
    const bounds = makeBounds({ time: { startBeat: 0, endBeat: 64 } });
    const params = { restProbability: 0.5, stepBeats: 0.25 };
    const first = pulseSourceOperator.process(
      ctx,
      {},
      pulseRequest({ bounds, params, variation: makeVariation({ generation: 0 }) }),
    );
    const second = pulseSourceOperator.process(
      ctx,
      {},
      pulseRequest({ bounds, params, variation: makeVariation({ generation: 1 }) }),
    );
    expect((first.rhythm as RhythmPlan).events).not.toEqual((second.rhythm as RhythmPlan).events);
  });

  it('keeps rhythm stable across a reroll when the rhythm dimension is locked', () => {
    const params = { restProbability: 0.5 };
    const locks = { ...makeVariation().locks, rhythm: true };
    const first = pulseSourceOperator.process(
      ctx,
      {},
      pulseRequest({ params, variation: makeVariation({ generation: 0, locks }) }),
    );
    const second = pulseSourceOperator.process(
      ctx,
      {},
      pulseRequest({ params, variation: makeVariation({ generation: 1, locks }) }),
    );
    expect((first.rhythm as RhythmPlan).events).toEqual((second.rhythm as RhythmPlan).events);
  });

  it('never emits an onset outside the time bounds', () => {
    const bounds = makeBounds({ time: { startBeat: 2, endBeat: 5 } });
    const result = pulseSourceOperator.process(
      ctx,
      {},
      pulseRequest({ bounds, params: { stepBeats: 0.5 } }),
    );
    const plan = result.rhythm as RhythmPlan;
    for (const event of plan.events) {
      expect(event.startBeat).toBeGreaterThanOrEqual(bounds.time.startBeat);
      expect(event.startBeat + event.durationBeats).toBeLessThanOrEqual(bounds.time.endBeat);
    }
  });
});

describe('pulseRenderNotesOperator', () => {
  const rhythmPlan: RhythmPlan = {
    kind: 'rhythm',
    bounds: makeBounds(),
    diagnostics: [],
    events: [
      { startBeat: 0, durationBeats: 0.8, accent: 1 },
      { startBeat: 1, durationBeats: 0.8, accent: 0.7 },
    ],
  };

  it('stamps the configured pitch onto every rhythm onset', () => {
    const result = pulseRenderNotesOperator.process(
      ctx,
      { rhythm: rhythmPlan },
      pulseRequest({ nodeId: 'renderer', params: { midiNote: 67, velocity: 90 } }),
    );
    const plan = result.notes as NotePlan;
    expect(plan.notes).toHaveLength(2);
    expect(plan.notes.every((n) => n.midiNote === 67)).toBe(true);
    expect(plan.notes.every((n) => n.velocity === 90)).toBe(true);
  });

  it('produces unique, stable eventKeys within one evaluation', () => {
    const result = pulseRenderNotesOperator.process(
      ctx,
      { rhythm: rhythmPlan },
      pulseRequest({ nodeId: 'renderer' }),
    );
    const plan = result.notes as NotePlan;
    const keys = plan.notes.map((n) => n.eventKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('degrades to an empty note plan rather than throwing when its rhythm input is missing (a bypassed upstream with no passthrough)', () => {
    const result = pulseRenderNotesOperator.process(ctx, {}, pulseRequest({ nodeId: 'renderer' }));
    const plan = result.notes as NotePlan;
    expect(plan.notes).toEqual([]);
  });

  it('clamps the configured pitch into the request pitch bounds', () => {
    const bounds = makeBounds({ pitch: { minMidi: 60, maxMidi: 64 } });
    const result = pulseRenderNotesOperator.process(
      ctx,
      { rhythm: { ...rhythmPlan, bounds } },
      pulseRequest({ nodeId: 'renderer', bounds, params: { midiNote: 100 } }),
    );
    const plan = result.notes as NotePlan;
    expect(plan.notes.every((n) => n.midiNote <= 64)).toBe(true);
  });
});

describe('transposeNotesOperator', () => {
  const notePlan: NotePlan = {
    kind: 'notes',
    bounds: makeBounds(),
    diagnostics: [],
    notes: [{ eventKey: 'a', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 }],
  };

  it('shifts every note by the configured semitones', () => {
    const result = transposeNotesOperator.process(
      ctx,
      { notes: notePlan },
      pulseRequest({ nodeId: 'transpose', params: { semitones: 7 } }),
    );
    const plan = result.notes as NotePlan;
    expect(plan.notes[0].midiNote).toBe(67);
  });

  it('is a no-op at the default semitones: 0', () => {
    const result = transposeNotesOperator.process(
      ctx,
      { notes: notePlan },
      pulseRequest({ nodeId: 'transpose', params: transposeNotesOperator.getDefaultParams(ctx) }),
    );
    const plan = result.notes as NotePlan;
    expect(plan.notes[0].midiNote).toBe(60);
  });

  it('degrades to an empty note plan rather than throwing when its notes input is missing', () => {
    const result = transposeNotesOperator.process(
      ctx,
      {},
      pulseRequest({ nodeId: 'transpose', params: { semitones: 7 } }),
    );
    const plan = result.notes as NotePlan;
    expect(plan.notes).toEqual([]);
  });
});
