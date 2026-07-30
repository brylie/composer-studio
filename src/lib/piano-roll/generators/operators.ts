// Application-facing operator registry (generators.md §5, §9.1, §18 Phase C).
//
// Phase D still owns migrating generate-chords and implementing arpeggiate/
// euclidean-rhythm/ostinato-generate/motif-generate. The two operators below
// implement generators.md §9.1's `pulse-pattern` ("a simpler deterministic
// family member for regular subdivisions ... useful both on its own and as
// infrastructure") plus a small transpose processor — enough real,
// deterministic musical behavior to exercise Phase C's session UI (bounds,
// module chain, reroll/locks, Recompute) end to end without reaching into
// Phase D's assigned catalog.

import { MAX_MIDI, MIN_MIDI } from '../types.js';
import {
  clampMidi,
  clampToPitchBounds,
  clampUnit,
  clampVelocity,
  gatedDuration,
} from './operator-utils.js';
import { arpeggiateOperator } from './operators-arpeggiate.js';
import {
  chordSourceOperator,
  eventRenderNotesOperator,
  smoothVoicingOperator,
} from './operators-harmony.js';
import { motifGenerateOperator } from './operators-motif.js';
import { ostinatoGenerateOperator } from './operators-ostinato.js';
import { euclideanGateOperator, euclideanSourceOperator } from './operators-rhythm.js';
import { dimensionRandom } from './random.js';
import type {
  GeneratedNoteDraft,
  GeneratorOperatorDescriptor,
  NotePlan,
  RhythmPlan,
} from './types.js';

// ── pulse-source (generators.md §9.1) ───────────────────────────────────────

export interface PulseSourceParams extends Record<string, unknown> {
  stepBeats: number;
  gate: number;
  restProbability: number;
}

/**
 * Regular onset pattern across the session's time bounds, with a seeded
 * chance of omitting a step (generators.md §9.1's "accents, rests, and
 * probability-limited omissions"). The rhythm dimension's sub-seed is
 * generation-independent when `locks.rhythm` is set, so a locked rhythm
 * survives a reroll of other dimensions — the same pattern
 * test-helpers.ts's makeSeededPitchSourceOperator documents for pitch.
 */
export const pulseSourceOperator: GeneratorOperatorDescriptor = {
  id: 'pulse-source',
  version: 1,
  label: 'Pulse',
  role: 'source',
  inputs: {},
  outputs: { rhythm: { kind: 'rhythm' } },
  contextDependencies: [],
  variationDimensions: ['rhythm'],
  paramFields: [
    {
      key: 'stepBeats',
      label: 'Step (beats)',
      type: 'number',
      min: 0.25,
      max: 4,
      step: 0.25,
      default: 1,
    },
    { key: 'gate', label: 'Gate', type: 'range', min: 0.1, max: 1, step: 0.05, default: 0.8 },
    {
      key: 'restProbability',
      label: 'Rest chance',
      type: 'range',
      min: 0,
      max: 0.9,
      step: 0.05,
      default: 0,
    },
  ],
  summary(params) {
    return `${String(params.stepBeats)}-beat pulses, ${String(Math.round(Number(params.gate) * 100))}% gate`;
  },
  getDefaultParams: () => ({ stepBeats: 1, gate: 0.8, restProbability: 0 }),
  process(_ctx, _inputs, request) {
    const { bounds, variation, nodeId } = request;
    const stepBeats = Math.max(0.0625, Number(request.params.stepBeats) || 1);
    const gate = clampUnit(Number(request.params.gate ?? 0.8));
    const restProbability = clampUnit(Number(request.params.restProbability ?? 0));

    const random = dimensionRandom(variation, nodeId, 'rhythm');

    // Iterates by onset start rather than a precomputed `floor(span /
    // stepBeats)` step count — that undercounts whenever the span isn't an
    // exact multiple of stepBeats (e.g. bounds 0–3.5 with a 1-beat step has
    // a valid onset at beat 3, which floor(3.5) = 3 steps would have
    // skipped). Each onset's duration is truncated to the remaining span
    // when allowTail is false, so a trailing partial step never produces an
    // onset that ends past bounds.time.endBeat.
    const events: RhythmPlan['events'] = [];
    const epsilon = 1e-9;
    let i = 0;
    for (
      let startBeat = bounds.time.startBeat;
      startBeat < bounds.time.endBeat - epsilon;
      startBeat += stepBeats, i++
    ) {
      if (restProbability > 0 && random() < restProbability) continue;
      const durationBeats = gatedDuration(stepBeats * gate, startBeat, bounds);
      events.push({
        startBeat,
        durationBeats,
        accent: i % 4 === 0 ? 1 : 0.7,
      });
    }

    return {
      rhythm: { kind: 'rhythm', bounds, diagnostics: [], events } satisfies RhythmPlan,
    };
  },
};

// ── pulse-render-notes (generators.md §5's "note renderer") ────────────────

export interface PulseRenderNotesParams extends Record<string, unknown> {
  midiNote: number;
  velocity: number;
  velocityVariation: number;
}

/** Stamps a fixed pitch onto every onset from an upstream RhythmPlan, producing the recipe's final NotePlan. */
export const pulseRenderNotesOperator: GeneratorOperatorDescriptor = {
  id: 'pulse-render-notes',
  version: 1,
  label: 'Note renderer',
  role: 'renderer',
  inputs: { rhythm: { kind: 'rhythm' } },
  outputs: { notes: { kind: 'notes' } },
  contextDependencies: [],
  variationDimensions: ['dynamics'],
  paramFields: [
    { key: 'midiNote', label: 'Pitch', type: 'number', min: MIN_MIDI, max: MAX_MIDI, default: 60 },
    { key: 'velocity', label: 'Velocity', type: 'number', min: 1, max: 127, default: 100 },
    {
      key: 'velocityVariation',
      label: 'Velocity variation',
      type: 'range',
      min: 0,
      max: 1,
      step: 0.05,
      default: 0,
    },
  ],
  summary(params) {
    return `pitch ${String(params.midiNote)}, vel ${String(params.velocity)}`;
  },
  getDefaultParams: () => ({ midiNote: 60, velocity: 100, velocityVariation: 0 }),
  process(_ctx, inputs, request) {
    // A bypassed upstream source has no matching input to pass through, so
    // its 'rhythm' output port is simply omitted (evaluator.ts's
    // bypassOutputs) — inputs.rhythm can legitimately be undefined here.
    // Degrade to "no onsets" rather than crashing on plan.events.
    const plan = inputs.rhythm as RhythmPlan | undefined;
    const events = plan?.events ?? [];
    const { bounds, variation, nodeId } = request;
    const midiNote = clampToPitchBounds(clampMidi(Number(request.params.midiNote ?? 60)), bounds);
    const baseVelocity = clampVelocity(Number(request.params.velocity ?? 100));
    const velocityVariation = clampUnit(Number(request.params.velocityVariation ?? 0));

    const random = dimensionRandom(variation, nodeId, 'dynamics');

    const notes: GeneratedNoteDraft[] = events.map((event, i) => {
      const jitter =
        velocityVariation > 0 ? Math.round((random() * 2 - 1) * velocityVariation * 40) : 0;
      return {
        eventKey: `${nodeId}:${String(i)}`,
        midiNote,
        startBeat: event.startBeat,
        durationBeats: event.durationBeats,
        velocity: clampVelocity(baseVelocity + jitter),
        role: 'primary',
        sourceStep: i,
      };
    });

    return {
      notes: { kind: 'notes', bounds, diagnostics: [], notes } satisfies NotePlan,
    };
  },
};

// ── transpose-notes (an insertable processor module) ────────────────────────

export interface TransposeNotesParams extends Record<string, unknown> {
  semitones: number;
}

/** Identity-capable in/out 'notes' processor — bypassing it passes its input plan through unchanged. */
export const transposeNotesOperator: GeneratorOperatorDescriptor = {
  id: 'transpose-notes',
  version: 1,
  label: 'Transpose',
  role: 'processor',
  inputs: { notes: { kind: 'notes' } },
  outputs: { notes: { kind: 'notes' } },
  contextDependencies: [],
  paramFields: [
    { key: 'semitones', label: 'Semitones', type: 'number', min: -24, max: 24, default: 0 },
  ],
  summary(params) {
    const semitones = Number(params.semitones);
    return `${semitones >= 0 ? '+' : ''}${String(semitones)} semitones`;
  },
  getDefaultParams: () => ({ semitones: 0 }),
  process(_ctx, inputs, request) {
    // Same defensive handling as pulse-render-notes above — a bypassed
    // upstream with no passthrough can leave this input undefined.
    const plan = inputs.notes as NotePlan | undefined;
    const semitones = Math.round(Number(request.params.semitones ?? 0));
    const notes = (plan?.notes ?? []).map((note) => ({
      ...note,
      midiNote: clampMidi(clampToPitchBounds(note.midiNote + semitones, request.bounds)),
    }));
    return {
      notes: { kind: 'notes', bounds: request.bounds, diagnostics: [], notes } satisfies NotePlan,
    };
  },
};

// Phase D's harmony/rhythm/arpeggio/ostinato/motif operators (generators.md
// §18) live in sibling operators-*.ts files, one per family, rather than
// growing this file indefinitely — but the registry stays one combined map
// here so every other module can keep importing a single `operatorRegistry`.
export const operatorRegistry: ReadonlyMap<string, GeneratorOperatorDescriptor> = new Map([
  [pulseSourceOperator.id, pulseSourceOperator],
  [pulseRenderNotesOperator.id, pulseRenderNotesOperator],
  [transposeNotesOperator.id, transposeNotesOperator],
  [chordSourceOperator.id, chordSourceOperator],
  [smoothVoicingOperator.id, smoothVoicingOperator],
  [eventRenderNotesOperator.id, eventRenderNotesOperator],
  [euclideanSourceOperator.id, euclideanSourceOperator],
  [euclideanGateOperator.id, euclideanGateOperator],
  [arpeggiateOperator.id, arpeggiateOperator],
  [ostinatoGenerateOperator.id, ostinatoGenerateOperator],
  [motifGenerateOperator.id, motifGenerateOperator],
]);
