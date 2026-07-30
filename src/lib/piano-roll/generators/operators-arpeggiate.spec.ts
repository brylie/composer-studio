import { describe, expect, it } from 'vitest';
import { arpeggiateOperator } from './operators-arpeggiate.js';
import { makeBounds, makeGeneratorContext, makeVariation } from './test-helpers.js';
import type { EventPlan, OperatorRequest } from './types.js';

const ctx = makeGeneratorContext();

function request(overrides: Partial<OperatorRequest> = {}): OperatorRequest {
  return {
    bounds: makeBounds(),
    params: {},
    variation: makeVariation(),
    nodeId: 'node',
    ...overrides,
  };
}

const chordEvents: EventPlan['events'] = [
  { startBeat: 0, durationBeats: 2, pitches: [60, 64, 67], velocity: 80, role: 'support' },
];
const chordPlan: EventPlan = {
  kind: 'events',
  bounds: makeBounds(),
  diagnostics: [],
  events: chordEvents,
};

describe('arpeggiateOperator', () => {
  it('plays each chord tone in ascending order for the "up" pattern', () => {
    const result = arpeggiateOperator.process(
      ctx,
      { events: chordPlan },
      request({
        params: { pattern: 'up', stepBeats: 0.5, octaveSpan: 1, gate: 0.8, restart: 'per-chord' },
      }),
    );
    const plan = result.events as EventPlan;
    expect(plan.events.map((e) => e.pitches[0])).toEqual([60, 64, 67, 60]);
  });

  it('plays each chord tone in descending order for the "down" pattern', () => {
    const result = arpeggiateOperator.process(
      ctx,
      { events: chordPlan },
      request({
        params: { pattern: 'down', stepBeats: 0.5, octaveSpan: 1, gate: 0.8, restart: 'per-chord' },
      }),
    );
    const plan = result.events as EventPlan;
    expect(plan.events.map((e) => e.pitches[0])).toEqual([67, 64, 60, 67]);
  });

  it('expands across octaveSpan octaves', () => {
    const result = arpeggiateOperator.process(
      ctx,
      { events: chordPlan },
      request({
        bounds: makeBounds({
          time: { startBeat: 0, endBeat: 2 },
          pitch: { minMidi: 36, maxMidi: 107 },
        }),
        params: { pattern: 'up', stepBeats: 0.5, octaveSpan: 2, gate: 0.8, restart: 'per-chord' },
      }),
    );
    const plan = result.events as EventPlan;
    expect(plan.events.map((e) => e.pitches[0])).toEqual([60, 64, 67, 72]);
  });

  it('every output event has exactly one pitch', () => {
    const result = arpeggiateOperator.process(
      ctx,
      { events: chordPlan },
      request({
        params: { pattern: 'up', stepBeats: 0.25, octaveSpan: 1, gate: 0.8, restart: 'per-chord' },
      }),
    );
    for (const event of (result.events as EventPlan).events) {
      expect(event.pitches).toHaveLength(1);
    }
  });

  it('never produces an event outside the source event span', () => {
    const result = arpeggiateOperator.process(
      ctx,
      { events: chordPlan },
      request({
        params: { pattern: 'up', stepBeats: 0.5, octaveSpan: 1, gate: 0.8, restart: 'per-chord' },
      }),
    );
    for (const event of (result.events as EventPlan).events) {
      expect(event.startBeat).toBeGreaterThanOrEqual(0);
      expect(event.startBeat).toBeLessThan(2);
    }
  });

  it('degrades to an empty events plan when its events input is missing', () => {
    const result = arpeggiateOperator.process(ctx, {}, request());
    expect((result.events as EventPlan).events).toEqual([]);
  });

  it('is deterministic for a fixed non-random pattern', () => {
    const req = request({ params: { pattern: 'up-down', stepBeats: 0.25 } });
    expect(arpeggiateOperator.process(ctx, { events: chordPlan }, req)).toEqual(
      arpeggiateOperator.process(ctx, { events: chordPlan }, req),
    );
  });

  it('varies order across an unlocked reroll for the "random" pattern', () => {
    const wideChord: EventPlan = {
      kind: 'events',
      bounds: makeBounds(),
      diagnostics: [],
      events: [
        { startBeat: 0, durationBeats: 4, pitches: [60, 62, 64, 65, 67, 69, 71], velocity: 80 },
      ],
    };
    const params = {
      pattern: 'random',
      stepBeats: 0.25,
      octaveSpan: 1,
      gate: 0.8,
      restart: 'per-chord',
    };
    const first = arpeggiateOperator.process(
      ctx,
      { events: wideChord },
      request({ params, variation: makeVariation({ generation: 0 }) }),
    );
    const second = arpeggiateOperator.process(
      ctx,
      { events: wideChord },
      request({ params, variation: makeVariation({ generation: 1 }) }),
    );
    expect((first.events as EventPlan).events.map((e) => e.pitches[0])).not.toEqual(
      (second.events as EventPlan).events.map((e) => e.pitches[0]),
    );
  });

  it('keeps order stable across a reroll when the contour dimension is locked', () => {
    const wideChord: EventPlan = {
      kind: 'events',
      bounds: makeBounds(),
      diagnostics: [],
      events: [
        { startBeat: 0, durationBeats: 4, pitches: [60, 62, 64, 65, 67, 69, 71], velocity: 80 },
      ],
    };
    const params = {
      pattern: 'random',
      stepBeats: 0.25,
      octaveSpan: 1,
      gate: 0.8,
      restart: 'per-chord',
    };
    const locks = { ...makeVariation().locks, contour: true };
    const first = arpeggiateOperator.process(
      ctx,
      { events: wideChord },
      request({ params, variation: makeVariation({ generation: 0, locks }) }),
    );
    const second = arpeggiateOperator.process(
      ctx,
      { events: wideChord },
      request({ params, variation: makeVariation({ generation: 1, locks }) }),
    );
    expect((first.events as EventPlan).events.map((e) => e.pitches[0])).toEqual(
      (second.events as EventPlan).events.map((e) => e.pitches[0]),
    );
  });

  it('continuous restart carries the pattern index across chord events', () => {
    const twoChords: EventPlan = {
      kind: 'events',
      bounds: makeBounds({ time: { startBeat: 0, endBeat: 4 } }),
      diagnostics: [],
      events: [
        { startBeat: 0, durationBeats: 1, pitches: [60, 64], velocity: 80 },
        { startBeat: 1, durationBeats: 1, pitches: [62, 65], velocity: 80 },
      ],
    };
    const result = arpeggiateOperator.process(
      ctx,
      { events: twoChords },
      request({
        bounds: makeBounds({ time: { startBeat: 0, endBeat: 4 } }),
        params: { pattern: 'up', stepBeats: 0.5, octaveSpan: 1, gate: 0.8, restart: 'continuous' },
      }),
    );
    const pitches = (result.events as EventPlan).events.map((e) => e.pitches[0]);
    // Chord 1: [60, 64] at index 0,1. Continuous carries index into chord 2's
    // own [62, 65] ordering, starting at index 2 (-> 62 again, then 65) rather
    // than resetting to index 0.
    expect(pitches).toEqual([60, 64, 62, 65]);
  });
});
