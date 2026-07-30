// Application-facing rhythm-family operators for Euclidean generators
// (generators.md §9.1, §18 Phase D item 3): "Implement euclidean-rhythm and
// Euclidean gate/slicer operators." euclideanSourceOperator is a rhythm
// source (paired with operators.ts's existing pulseRenderNotesOperator to
// form the euclidean-rhythm starter); euclideanGateOperator is an EventPlan
// slicer usable after any chord/arpeggio chain (generators.md §8.1's
// "Arpeggio on a Euclidean rhythm" and "Euclidean chord slices" examples).
// Both share euclidean.ts's pulse algorithm rather than duplicating it.

import { MIN_DURATION_BEATS } from '../types.js';
import { euclideanPattern } from './euclidean.js';
import { clampPulses, clampSteps, clampUnit, gatedDuration } from './operator-utils.js';
import type { EventPlan, GeneratorOperatorDescriptor, RhythmPlan } from './types.js';

// ── euclidean-source (generators.md §9.1) ───────────────────────────────────

export interface EuclideanSourceParams extends Record<string, unknown> {
  steps: number;
  pulses: number;
  rotation: number;
  stepBeats: number;
  gate: number;
}

/** A rhythm source whose onsets follow a Euclidean pulse pattern instead of pulse-source's regular grid. */
export const euclideanSourceOperator: GeneratorOperatorDescriptor = {
  id: 'euclidean-source',
  version: 1,
  label: 'Euclidean',
  role: 'source',
  inputs: {},
  outputs: { rhythm: { kind: 'rhythm' } },
  variationDimensions: [],
  paramFields: [
    { key: 'steps', label: 'Steps', type: 'number', min: 1, max: 32, step: 1, default: 8 },
    { key: 'pulses', label: 'Pulses', type: 'number', min: 0, max: 32, step: 1, default: 3 },
    { key: 'rotation', label: 'Rotation', type: 'number', min: 0, max: 31, step: 1, default: 0 },
    {
      key: 'stepBeats',
      label: 'Step (beats)',
      type: 'number',
      min: 0.125,
      max: 2,
      step: 0.125,
      default: 0.5,
    },
    { key: 'gate', label: 'Gate', type: 'range', min: 0.1, max: 1, step: 0.05, default: 0.85 },
  ],
  summary(params) {
    return `${String(params.pulses)}/${String(params.steps)} euclid`;
  },
  getDefaultParams: () => ({ steps: 8, pulses: 3, rotation: 0, stepBeats: 0.5, gate: 0.85 }),
  process(_ctx, _inputs, request) {
    const { bounds, params } = request;
    const steps = clampSteps(params.steps, 8);
    const pulses = clampPulses(params.pulses, steps, 3);
    const rotation = Math.round(Number(params.rotation ?? 0));
    const stepBeats = Math.max(0.0625, Number(params.stepBeats ?? 0.5));
    const gate = clampUnit(Number(params.gate ?? 0.85));
    const pattern = euclideanPattern(steps, pulses, rotation);

    const events: RhythmPlan['events'] = [];
    const epsilon = 1e-9;
    let i = 0;
    for (
      let startBeat = bounds.time.startBeat;
      startBeat < bounds.time.endBeat - epsilon;
      startBeat += stepBeats, i++
    ) {
      if (pattern.length === 0 || !pattern[i % pattern.length]) continue;
      const durationBeats = gatedDuration(stepBeats * gate, startBeat, bounds);
      events.push({ startBeat, durationBeats, accent: i % steps === 0 ? 1 : 0.7 });
    }

    return {
      rhythm: { kind: 'rhythm', bounds, diagnostics: [], events } satisfies RhythmPlan,
    };
  },
};

// ── euclidean-gate (generators.md §8.1, §9.1) ───────────────────────────────

export interface EuclideanGateParams extends Record<string, unknown> {
  steps: number;
  pulses: number;
  rotation: number;
  gateLength: number;
}

/**
 * An EventPlan slicer: keeps only the events at Euclidean-pulse positions in
 * their own sequence order (cycling the pattern across however many events
 * arrive), shortening each surviving event by `gateLength` — generators.md
 * §8.1's "Euclidean gate(5 pulses, 8 steps, rotation 1)" and "Euclidean
 * slicer(3 pulses, 8 steps)" roles for the same shared pulse algorithm.
 */
export const euclideanGateOperator: GeneratorOperatorDescriptor = {
  id: 'euclidean-gate',
  version: 1,
  label: 'Euclidean gate',
  role: 'processor',
  inputs: { events: { kind: 'events' } },
  outputs: { events: { kind: 'events' } },
  paramFields: [
    { key: 'steps', label: 'Steps', type: 'number', min: 1, max: 32, step: 1, default: 8 },
    { key: 'pulses', label: 'Pulses', type: 'number', min: 0, max: 32, step: 1, default: 5 },
    { key: 'rotation', label: 'Rotation', type: 'number', min: 0, max: 31, step: 1, default: 0 },
    {
      key: 'gateLength',
      label: 'Gate length',
      type: 'range',
      min: 0.1,
      max: 1,
      step: 0.05,
      default: 0.8,
    },
  ],
  summary(params) {
    return `gate ${String(params.pulses)}/${String(params.steps)}`;
  },
  getDefaultParams: () => ({ steps: 8, pulses: 5, rotation: 0, gateLength: 0.8 }),
  process(_ctx, inputs, request) {
    const plan = inputs.events as EventPlan | undefined;
    const sourceEvents = plan?.events ?? [];
    const { bounds, params } = request;
    const steps = clampSteps(params.steps, 8);
    const pulses = clampPulses(params.pulses, steps, 5);
    const rotation = Math.round(Number(params.rotation ?? 0));
    const gateLength = clampUnit(Number(params.gateLength ?? 0.8));
    const pattern = euclideanPattern(steps, pulses, rotation);

    const events: EventPlan['events'] = [];
    for (let i = 0; i < sourceEvents.length && pattern.length > 0; i++) {
      if (!pattern[i % pattern.length]) continue;
      const event = sourceEvents[i];
      const gated = Math.max(MIN_DURATION_BEATS, event.durationBeats * gateLength);
      const durationBeats = bounds.allowTail
        ? gated
        : Math.min(gated, Math.max(MIN_DURATION_BEATS, bounds.time.endBeat - event.startBeat));
      events.push({ ...event, durationBeats });
    }

    return {
      events: { kind: 'events', bounds, diagnostics: [], events } satisfies EventPlan,
    };
  },
};
