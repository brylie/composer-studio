import { describe, expect, it } from 'vitest';
import { euclideanGateOperator, euclideanSourceOperator } from './operators-rhythm.js';
import { makeBounds, makeGeneratorContext, makeVariation } from './test-helpers.js';
import type { EventPlan, OperatorRequest, RhythmPlan } from './types.js';

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

describe('euclideanSourceOperator', () => {
  it('produces exactly `pulses` onsets per full pattern cycle', () => {
    const bounds = makeBounds({ time: { startBeat: 0, endBeat: 4 } });
    const result = euclideanSourceOperator.process(
      ctx,
      {},
      request({ bounds, params: { steps: 8, pulses: 3, rotation: 0, stepBeats: 0.5, gate: 0.8 } }),
    );
    const plan = result.rhythm as RhythmPlan;
    // 4 beats / 0.5 stepBeats = 8 steps = exactly one full pattern cycle.
    expect(plan.events).toHaveLength(3);
  });

  it('is deterministic for a fixed request', () => {
    const req = request({ params: { steps: 8, pulses: 5, rotation: 2 } });
    expect(euclideanSourceOperator.process(ctx, {}, req)).toEqual(
      euclideanSourceOperator.process(ctx, {}, req),
    );
  });

  it('changing rotation changes onset placement without changing the onset count', () => {
    const bounds = makeBounds({ time: { startBeat: 0, endBeat: 4 } });
    const a = euclideanSourceOperator.process(
      ctx,
      {},
      request({ bounds, params: { steps: 8, pulses: 3, rotation: 0, stepBeats: 0.5 } }),
    );
    const b = euclideanSourceOperator.process(
      ctx,
      {},
      request({ bounds, params: { steps: 8, pulses: 3, rotation: 2, stepBeats: 0.5 } }),
    );
    const startsA = (a.rhythm as RhythmPlan).events.map((e) => e.startBeat);
    const startsB = (b.rhythm as RhythmPlan).events.map((e) => e.startBeat);
    expect(startsA).not.toEqual(startsB);
    expect(startsA.length).toBe(startsB.length);
  });

  it('never emits an onset outside the time bounds', () => {
    const bounds = makeBounds({ time: { startBeat: 2, endBeat: 5 } });
    const result = euclideanSourceOperator.process(
      ctx,
      {},
      request({ bounds, params: { steps: 5, pulses: 3, stepBeats: 0.5 } }),
    );
    for (const event of (result.rhythm as RhythmPlan).events) {
      expect(event.startBeat).toBeGreaterThanOrEqual(bounds.time.startBeat);
      expect(event.startBeat + event.durationBeats).toBeLessThanOrEqual(bounds.time.endBeat + 1e-9);
    }
  });

  it('clamps pulses above steps to steps (never more onsets than steps)', () => {
    const bounds = makeBounds({ time: { startBeat: 0, endBeat: 4 } });
    const result = euclideanSourceOperator.process(
      ctx,
      {},
      request({ bounds, params: { steps: 4, pulses: 999, stepBeats: 1 } }),
    );
    expect((result.rhythm as RhythmPlan).events).toHaveLength(4);
  });
});

describe('euclideanGateOperator', () => {
  const events: EventPlan['events'] = Array.from({ length: 8 }, (_, i) => ({
    startBeat: i * 0.5,
    durationBeats: 0.5,
    pitches: [60 + i],
    velocity: 80,
    role: 'support',
  }));
  const eventPlan: EventPlan = { kind: 'events', bounds: makeBounds(), diagnostics: [], events };

  it('keeps only events at pulse positions, matching the pulse count', () => {
    const result = euclideanGateOperator.process(
      ctx,
      { events: eventPlan },
      request({ params: { steps: 8, pulses: 3, rotation: 0, gateLength: 0.8 } }),
    );
    const plan = result.events as EventPlan;
    expect(plan.events).toHaveLength(3);
  });

  it('shortens surviving events by gateLength', () => {
    const result = euclideanGateOperator.process(
      ctx,
      { events: eventPlan },
      request({ params: { steps: 8, pulses: 8, rotation: 0, gateLength: 0.5 } }),
    );
    const plan = result.events as EventPlan;
    for (const event of plan.events) {
      expect(event.durationBeats).toBeCloseTo(0.25);
    }
  });

  it('degrades to an empty events plan when its events input is missing', () => {
    const result = euclideanGateOperator.process(ctx, {}, request());
    expect((result.events as EventPlan).events).toEqual([]);
  });

  it('is deterministic for a fixed request', () => {
    const req = request({ params: { steps: 8, pulses: 5 } });
    expect(euclideanGateOperator.process(ctx, { events: eventPlan }, req)).toEqual(
      euclideanGateOperator.process(ctx, { events: eventPlan }, req),
    );
  });
});
