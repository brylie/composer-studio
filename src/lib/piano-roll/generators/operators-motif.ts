// Application-facing motif-family operator (generators.md §9.3, §18 Phase D
// item 5): "Implement motif-generate." Another single-node 'realizer'
// operator (see operators-ostinato.ts's doc comment for why): a motif's
// rhythmic cell, scale-degree contour, and repetition are one coherent
// musical idea, not a chain of otherwise-reusable plan stages.

import { scaleDegreeToMidi } from '../../music-theory/index.js';
import { activeEventAt } from '../timeline.js';
import { MIN_DURATION_BEATS } from '../types.js';
import { clampMidi, clampToPitchBounds, clampUnit } from './operator-utils.js';
import { dimensionRandom } from './random.js';
import type { GeneratedNoteDraft, GeneratorOperatorDescriptor, NotePlan } from './types.js';

export type MotifContour = 'arch' | 'valley' | 'ascending' | 'descending' | 'mixed';
export type MotifSource = 'active-scale' | 'selection-derived';

export interface MotifGenerateParams extends Record<string, unknown> {
  source: MotifSource;
  lengthBeats: number;
  eventCount: number;
  contour: MotifContour;
  maxLeapSemitones: number;
  repetition: number;
  variationAmount: number;
}

/**
 * Relative scale-degree offsets shaping one contour cell. 'mixed' is the
 * only randomized shape (seeded via the contour dimension); every other
 * contour is a deterministic function of `eventCount` — generators.md §9.3's
 * "at least one dimension should repeat or develop" is satisfied by the
 * contour shape itself repeating across `repetition` cycles below.
 */
function buildContourDegrees(
  eventCount: number,
  contour: MotifContour,
  random: () => number,
): number[] {
  const half = Math.floor(eventCount / 2);
  const degrees: number[] = [];
  for (let i = 0; i < eventCount; i++) {
    switch (contour) {
      case 'ascending':
        degrees.push(i);
        break;
      case 'descending':
        degrees.push(-i);
        break;
      case 'arch':
        degrees.push(i <= half ? i : eventCount - 1 - i);
        break;
      case 'valley':
        degrees.push(i <= half ? -i : -(eventCount - 1 - i));
        break;
      case 'mixed':
        degrees.push(Math.round((random() * 2 - 1) * 3));
        break;
    }
  }
  return degrees;
}

/** A short coherent cell (rhythm + scale-degree contour) repeated `repetition` times, with bounded per-repeat pitch variation after the first. */
export const motifGenerateOperator: GeneratorOperatorDescriptor = {
  id: 'motif-generate',
  version: 1,
  label: 'Motif',
  role: 'realizer',
  inputs: {},
  outputs: { notes: { kind: 'notes' } },
  contextDependencies: ['active-scale', 'scale-track', 'selection'],
  variationDimensions: ['contour', 'pitch'],
  paramFields: [
    {
      key: 'source',
      label: 'Source',
      type: 'select',
      default: 'active-scale',
      options: [
        { value: 'active-scale', label: 'Active scale' },
        { value: 'selection-derived', label: 'Selection' },
      ],
    },
    {
      key: 'lengthBeats',
      label: 'Cell length (beats)',
      type: 'number',
      min: 0.5,
      max: 8,
      step: 0.5,
      default: 2,
    },
    { key: 'eventCount', label: 'Notes', type: 'number', min: 2, max: 12, step: 1, default: 4 },
    {
      key: 'contour',
      label: 'Contour',
      type: 'select',
      default: 'arch',
      options: [
        { value: 'arch', label: 'Arch' },
        { value: 'valley', label: 'Valley' },
        { value: 'ascending', label: 'Ascending' },
        { value: 'descending', label: 'Descending' },
        { value: 'mixed', label: 'Mixed' },
      ],
    },
    {
      key: 'maxLeapSemitones',
      label: 'Max leap',
      type: 'number',
      min: 1,
      max: 24,
      step: 1,
      default: 7,
    },
    {
      key: 'repetition',
      label: 'Repetitions',
      type: 'number',
      min: 1,
      max: 8,
      step: 1,
      default: 2,
    },
    {
      key: 'variationAmount',
      label: 'Variation',
      type: 'range',
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.15,
    },
  ],
  summary(params) {
    return `${String(params.contour)}, ${String(params.eventCount)}n × ${String(params.repetition)}`;
  },
  getDefaultParams: () => ({
    source: 'active-scale',
    lengthBeats: 2,
    eventCount: 4,
    contour: 'arch',
    maxLeapSemitones: 7,
    repetition: 2,
    variationAmount: 0.15,
  }),
  process(ctx, _inputs, request) {
    const { bounds, params, variation, nodeId } = request;
    const eventCount = Math.max(1, Math.round(Number(params.eventCount ?? 4)));
    const lengthBeats = Math.max(0.25, Number(params.lengthBeats ?? 2));
    const contour = (params.contour ?? 'arch') as MotifContour;
    const maxLeap = Math.max(1, Math.round(Number(params.maxLeapSemitones ?? 7)));
    const repetition = Math.max(1, Math.round(Number(params.repetition ?? 2)));
    const variationAmount = clampUnit(Number(params.variationAmount ?? 0.15));

    const contourRandom = dimensionRandom(variation, nodeId, 'contour');
    const degrees = buildContourDegrees(eventCount, contour, contourRandom);

    const selectionAnchor =
      params.source === 'selection-derived' && ctx.notes.length > 0
        ? Math.round(ctx.notes.reduce((sum, n) => sum + n.midiNote, 0) / ctx.notes.length)
        : null;
    const anchorMidi = clampToPitchBounds(
      clampMidi(selectionAnchor ?? Math.round((bounds.pitch.minMidi + bounds.pitch.maxMidi) / 2)),
      bounds,
    );

    const scaleEvent = activeEventAt(ctx.scaleTrack, bounds.time.startBeat);
    const scaleRoot = scaleEvent?.root ?? 0;
    const scaleMode = scaleEvent?.mode ?? 'major';

    const stepBeats = lengthBeats / eventCount;
    const cellPitches: number[] = [];
    let previousMidi = anchorMidi;
    for (const degree of degrees) {
      let midi = scaleDegreeToMidi(scaleRoot, scaleMode, degree, anchorMidi) ?? anchorMidi;
      const leap = midi - previousMidi;
      if (Math.abs(leap) > maxLeap) {
        midi = previousMidi + Math.sign(leap) * maxLeap;
      }
      midi = clampToPitchBounds(clampMidi(midi), bounds);
      cellPitches.push(midi);
      previousMidi = midi;
    }

    const pitchRandom = dimensionRandom(variation, nodeId, 'pitch');

    const notes: GeneratedNoteDraft[] = [];
    let eventIndex = 0;
    for (let rep = 0; rep < repetition; rep++) {
      const repStart = bounds.time.startBeat + rep * lengthBeats;
      if (repStart >= bounds.time.endBeat) break;
      for (let i = 0; i < cellPitches.length; i++) {
        const startBeat = repStart + i * stepBeats;
        if (startBeat >= bounds.time.endBeat) continue;
        const jitter =
          rep > 0 && variationAmount > 0 && pitchRandom() < variationAmount
            ? (pitchRandom() < 0.5 ? -1 : 1) * Math.round(pitchRandom() * 2)
            : 0;
        const midiNote = clampToPitchBounds(clampMidi(cellPitches[i] + jitter), bounds);
        const remaining = bounds.time.endBeat - startBeat;
        const rawDuration = Math.max(MIN_DURATION_BEATS, stepBeats * 0.9);
        const durationBeats = bounds.allowTail ? rawDuration : Math.min(rawDuration, remaining);
        if (durationBeats < MIN_DURATION_BEATS) continue;
        notes.push({
          eventKey: `${nodeId}:${String(eventIndex)}`,
          midiNote,
          startBeat,
          durationBeats,
          velocity: 95,
          role: 'primary',
          sourceStep: eventIndex,
        });
        eventIndex++;
      }
    }

    notes.sort((a, b) => a.startBeat - b.startBeat || a.midiNote - b.midiNote);
    return { notes: { kind: 'notes', bounds, diagnostics: [], notes } satisfies NotePlan };
  },
};
