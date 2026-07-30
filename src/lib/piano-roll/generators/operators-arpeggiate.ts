// Application-facing arpeggio-family operator (generators.md §9.4, §18
// Phase D item 2): "Implement arpeggiate." Takes an incoming EventPlan of
// (possibly multi-pitch) chord events — typically smooth-voicing's output —
// and expands each one into a sequence of single-pitch events following a
// chosen pattern, spanning `octaveSpan` octaves at `stepBeats` intervals.

import { MIN_DURATION_BEATS } from '../types.js';
import { clampMidi, clampToPitchBounds, clampUnit } from './operator-utils.js';
import { dimensionRandom } from './random.js';
import type { EventPlan, GeneratorOperatorDescriptor } from './types.js';

export type ArpeggiatePattern = 'up' | 'down' | 'up-down' | 'down-up' | 'random';

export interface ArpeggiateParams extends Record<string, unknown> {
  pattern: ArpeggiatePattern;
  stepBeats: number;
  octaveSpan: number;
  gate: number;
  restart: 'per-chord' | 'continuous';
}

/**
 * Orders a chord's expanded pitch collection according to `pattern`.
 * up-down/down-up drop the repeated endpoint (generators.md's "up-down"
 * pattern shouldn't play the top note twice in a row at the turnaround).
 */
function orderPitches(
  pitches: number[],
  pattern: ArpeggiatePattern,
  random: () => number,
): number[] {
  const ascending = [...pitches].sort((a, b) => a - b);
  switch (pattern) {
    case 'up':
      return ascending;
    case 'down':
      return [...ascending].reverse();
    case 'up-down': {
      const descendingInterior = [...ascending].reverse().slice(1, -1);
      return [...ascending, ...descendingInterior];
    }
    case 'down-up': {
      const ascendingInterior = ascending.slice(1, -1);
      return [...[...ascending].reverse(), ...ascendingInterior];
    }
    case 'random': {
      const shuffled = [...ascending];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    }
  }
}

/** Expands each incoming chord event into an ordered, stepped sequence of single-pitch events. */
export const arpeggiateOperator: GeneratorOperatorDescriptor = {
  id: 'arpeggiate',
  version: 1,
  label: 'Arpeggiate',
  role: 'processor',
  inputs: { events: { kind: 'events' } },
  outputs: { events: { kind: 'events' } },
  variationDimensions: ['contour'],
  paramFields: [
    {
      key: 'pattern',
      label: 'Pattern',
      type: 'select',
      default: 'up',
      options: [
        { value: 'up', label: 'Up' },
        { value: 'down', label: 'Down' },
        { value: 'up-down', label: 'Up-down' },
        { value: 'down-up', label: 'Down-up' },
        { value: 'random', label: 'Random' },
      ],
    },
    {
      key: 'stepBeats',
      label: 'Step (beats)',
      type: 'number',
      min: 0.0625,
      max: 2,
      step: 0.0625,
      default: 0.25,
    },
    {
      key: 'octaveSpan',
      label: 'Octave span',
      type: 'number',
      min: 1,
      max: 4,
      step: 1,
      default: 1,
    },
    { key: 'gate', label: 'Gate', type: 'range', min: 0.1, max: 1, step: 0.05, default: 0.8 },
    {
      key: 'restart',
      label: 'Restart',
      type: 'select',
      default: 'per-chord',
      options: [
        { value: 'per-chord', label: 'Per chord' },
        { value: 'continuous', label: 'Continuous' },
      ],
    },
  ],
  summary(params) {
    return `${String(params.pattern)}, ${String(params.octaveSpan)} oct`;
  },
  getDefaultParams: () => ({
    pattern: 'up',
    stepBeats: 0.25,
    octaveSpan: 1,
    gate: 0.8,
    restart: 'per-chord',
  }),
  process(_ctx, inputs, request) {
    const plan = inputs.events as EventPlan | undefined;
    const sourceEvents = plan?.events ?? [];
    const { bounds, params, variation, nodeId } = request;
    const pattern = (params.pattern ?? 'up') as ArpeggiatePattern;
    const stepBeats = Math.max(0.0625, Number(params.stepBeats ?? 0.25));
    const octaveSpan = Math.max(1, Math.round(Number(params.octaveSpan ?? 1)));
    const gate = clampUnit(Number(params.gate ?? 0.8));
    const restart = params.restart === 'continuous' ? 'continuous' : 'per-chord';

    const random = dimensionRandom(variation, nodeId, 'contour');

    const outEvents: EventPlan['events'] = [];
    let continuousIndex = 0;
    const epsilon = 1e-9;

    for (const source of sourceEvents) {
      if (source.pitches.length === 0) continue;
      const expanded: number[] = [];
      for (let octave = 0; octave < octaveSpan; octave++) {
        for (const pitch of source.pitches) expanded.push(pitch + octave * 12);
      }
      const ordered = orderPitches(expanded, pattern, random);
      if (ordered.length === 0) continue;

      const sourceEnd = source.startBeat + source.durationBeats;
      let index = restart === 'per-chord' ? 0 : continuousIndex;
      for (let t = source.startBeat; t < sourceEnd - epsilon; t += stepBeats) {
        const pitch = clampToPitchBounds(clampMidi(ordered[index % ordered.length]), bounds);
        const gateDuration = Math.max(MIN_DURATION_BEATS, stepBeats * gate);
        const remaining = Math.min(sourceEnd, bounds.time.endBeat) - t;
        const durationBeats = bounds.allowTail
          ? Math.min(gateDuration, sourceEnd - t)
          : Math.min(gateDuration, remaining);
        if (durationBeats >= MIN_DURATION_BEATS) {
          outEvents.push({
            startBeat: t,
            durationBeats,
            pitches: [pitch],
            velocity: source.velocity,
            role: 'primary',
          });
        }
        index++;
      }
      continuousIndex = index;
    }

    return {
      events: { kind: 'events', bounds, diagnostics: [], events: outEvents } satisfies EventPlan,
    };
  },
};
