// Application-facing ostinato-family operator (generators.md §9.8, §18
// Phase D item 4): "Implement ostinato-generate." A single self-contained
// operator (role: 'realizer' — it goes straight from source material to
// concrete notes, the way generators.md §5's role list allows, rather than
// composing through separate rhythm/pitch/voicing plan stages) because a
// repeating cell with bounded per-repeat transposition and variation is
// fundamentally its own scheduling algorithm (generators.md §3), not a
// composition of the harmony/rhythm primitives the other Phase D generators
// share.

import {
  notesInPitchClassRange,
  pitchClassesForChordEvent,
  pitchClassesForScaleEvent,
} from '../../music-theory/index.js';
import { activeEventAt } from '../timeline.js';
import { MIN_DURATION_BEATS } from '../types.js';
import { clampMidi, clampToPitchBounds, clampVelocity } from './operator-utils.js';
import { dimensionRandom } from './random.js';
import type {
  GeneratedNoteDraft,
  GeneratorBounds,
  GeneratorOperatorDescriptor,
  NotePlan,
} from './types.js';

export type OstinatoSource = 'selection' | 'active-chord' | 'active-scale';
export type OstinatoTransposition = 'none' | 'follow-scale' | 'follow-chord-root';

export interface OstinatoGenerateParams extends Record<string, unknown> {
  source: OstinatoSource;
  patternLengthBeats: number;
  repeats: number;
  transposition: OstinatoTransposition;
  variationEvery: number;
  variationAmount: number;
}

interface CellNote {
  offsetBeat: number;
  durationBeats: number;
  midiNote: number;
  velocity: number;
}

/** The selection's own notes, normalized to start at offset 0 and clipped to one cell length. */
function buildCellFromSelection(
  notes: { startBeat: number; durationBeats: number; midiNote: number; velocity: number }[],
  patternLengthBeats: number,
): CellNote[] {
  if (notes.length === 0) return [];
  const minStart = notes.reduce((min, n) => Math.min(min, n.startBeat), Infinity);
  return notes
    .map((n) => ({
      offsetBeat: n.startBeat - minStart,
      durationBeats: n.durationBeats,
      midiNote: n.midiNote,
      velocity: n.velocity,
    }))
    .filter((n) => n.offsetBeat < patternLengthBeats)
    .sort((a, b) => a.offsetBeat - b.offsetBeat);
}

/** A simple evenly-subdivided cell cycling through a pitch-class set's candidate MIDI notes within pitch bounds. */
function buildCellFromPitchClasses(
  pitchClasses: ReadonlySet<number>,
  bounds: GeneratorBounds,
  patternLengthBeats: number,
): CellNote[] {
  if (pitchClasses.size === 0) return [];
  const candidates = notesInPitchClassRange(
    pitchClasses,
    bounds.pitch.minMidi,
    bounds.pitch.maxMidi,
  );
  if (candidates.length === 0) return [];
  const eventCount = Math.max(1, Math.min(8, Math.round(patternLengthBeats * 2)));
  const stepBeats = patternLengthBeats / eventCount;
  const cell: CellNote[] = [];
  for (let i = 0; i < eventCount; i++) {
    cell.push({
      offsetBeat: i * stepBeats,
      durationBeats: Math.max(MIN_DURATION_BEATS, stepBeats * 0.9),
      midiNote: candidates[i % candidates.length],
      velocity: 90,
    });
  }
  return cell;
}

/** A repeating cell (selection, active chord, or active scale) with optional per-repeat transposition and bounded variation. */
export const ostinatoGenerateOperator: GeneratorOperatorDescriptor = {
  id: 'ostinato-generate',
  version: 1,
  label: 'Ostinato',
  role: 'realizer',
  inputs: {},
  outputs: { notes: { kind: 'notes' } },
  contextDependencies: ['selection', 'active-chord', 'chord-track', 'active-scale', 'scale-track'],
  variationDimensions: ['pitch'],
  paramFields: [
    {
      key: 'source',
      label: 'Source',
      type: 'select',
      default: 'active-chord',
      options: [
        { value: 'selection', label: 'Selection' },
        { value: 'active-chord', label: 'Active chord' },
        { value: 'active-scale', label: 'Active scale' },
      ],
    },
    {
      key: 'patternLengthBeats',
      label: 'Cell length (beats)',
      type: 'number',
      min: 0.25,
      max: 8,
      step: 0.25,
      default: 2,
    },
    { key: 'repeats', label: 'Repeats', type: 'number', min: 1, max: 16, step: 1, default: 4 },
    {
      key: 'transposition',
      label: 'Transposition',
      type: 'select',
      default: 'none',
      options: [
        { value: 'none', label: 'None' },
        { value: 'follow-scale', label: 'Follow scale' },
        { value: 'follow-chord-root', label: 'Follow chord root' },
      ],
    },
    {
      key: 'variationEvery',
      label: 'Variation every',
      type: 'number',
      min: 0,
      max: 16,
      step: 1,
      default: 0,
    },
    {
      key: 'variationAmount',
      label: 'Variation amount',
      type: 'number',
      min: 0,
      max: 12,
      step: 1,
      default: 0,
    },
  ],
  summary(params) {
    return `${String(params.repeats)}× ${String(params.patternLengthBeats)}b cell`;
  },
  getDefaultParams: () => ({
    source: 'active-chord',
    patternLengthBeats: 2,
    repeats: 4,
    transposition: 'none',
    variationEvery: 0,
    variationAmount: 0,
  }),
  process(ctx, _inputs, request) {
    const { bounds, params, variation, nodeId } = request;
    const source = params.source ?? 'active-chord';
    const patternLengthBeats = Math.max(0.25, Number(params.patternLengthBeats ?? 2));
    const repeats = Math.max(1, Math.round(Number(params.repeats ?? 4)));
    const transposition = params.transposition ?? 'none';
    const variationEvery = Math.max(0, Math.round(Number(params.variationEvery ?? 0)));
    const variationAmount = Math.max(0, Number(params.variationAmount ?? 0));

    let cell: CellNote[];
    let baseRoot: number | null = null;
    if (source === 'selection') {
      cell = buildCellFromSelection(ctx.notes, patternLengthBeats);
    } else if (source === 'active-scale') {
      const event = activeEventAt(ctx.scaleTrack, bounds.time.startBeat);
      if (event) {
        baseRoot = event.root;
        cell = buildCellFromPitchClasses(
          pitchClassesForScaleEvent(event.root, event.mode),
          bounds,
          patternLengthBeats,
        );
      } else {
        cell = [];
      }
    } else {
      const event = activeEventAt(ctx.chordTrack, bounds.time.startBeat);
      if (event) {
        baseRoot = event.root;
        cell = buildCellFromPitchClasses(
          pitchClassesForChordEvent(event.root, event.quality),
          bounds,
          patternLengthBeats,
        );
      } else {
        cell = [];
      }
    }

    if (cell.length === 0) {
      return { notes: { kind: 'notes', bounds, diagnostics: [], notes: [] } satisfies NotePlan };
    }

    const random = dimensionRandom(variation, nodeId, 'pitch');

    const notes: GeneratedNoteDraft[] = [];
    let eventIndex = 0;
    for (let repeat = 0; repeat < repeats; repeat++) {
      const repeatStart = bounds.time.startBeat + repeat * patternLengthBeats;
      if (repeatStart >= bounds.time.endBeat) break;

      let semitoneShift = 0;
      if (transposition !== 'none' && baseRoot !== null) {
        const event =
          transposition === 'follow-scale'
            ? activeEventAt(ctx.scaleTrack, repeatStart)
            : activeEventAt(ctx.chordTrack, repeatStart);
        if (event) {
          // Smallest signed pitch-class distance from the cell's original
          // root, so a repeat transposes by the shortest interval rather
          // than always jumping up.
          semitoneShift = ((((event.root - baseRoot) % 12) + 18) % 12) - 6;
        }
      }

      const applyVariation =
        variationEvery > 0 && (repeat + 1) % variationEvery === 0 && variationAmount > 0;

      for (const cellNote of cell) {
        const startBeat = repeatStart + cellNote.offsetBeat;
        if (startBeat >= bounds.time.endBeat) continue;
        const jitter = applyVariation ? Math.round((random() * 2 - 1) * variationAmount) : 0;
        const midiNote = clampToPitchBounds(
          clampMidi(cellNote.midiNote + semitoneShift + jitter),
          bounds,
        );
        const remaining = bounds.time.endBeat - startBeat;
        const durationBeats = bounds.allowTail
          ? cellNote.durationBeats
          : Math.min(cellNote.durationBeats, remaining);
        if (durationBeats < MIN_DURATION_BEATS) continue;
        notes.push({
          eventKey: `${nodeId}:${String(eventIndex)}`,
          midiNote,
          startBeat,
          durationBeats,
          velocity: clampVelocity(cellNote.velocity),
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
