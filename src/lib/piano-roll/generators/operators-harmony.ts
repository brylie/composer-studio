// Application-facing harmony/voicing operators (generators.md §9.6, §18
// Phase D item 1): "Migrate generate-chords into harmony-source, voicing,
// and note-renderer operators." chordSourceOperator and
// smoothVoicingOperator reproduce commands/generate-chords.ts's two source
// modes and its voiceChord-based smooth voice leading on the shared
// recipe/operator infrastructure; eventRenderNotesOperator is the generic
// EventPlan -> NotePlan renderer several other Phase D generators
// (arpeggiate, euclidean-gate chains) also terminate through.

import { voiceChord } from '../../music-theory/index.js';
import { chordSegments } from '../tracks.js';
import { MIN_DURATION_BEATS } from '../types.js';
import { clampMidi, clampToPitchBounds, clampUnit, clampVelocity } from './operator-utils.js';
import { createSeededRandom, deriveSeed } from './random.js';
import type {
  EventPlan,
  GeneratedNoteDraft,
  GeneratorBounds,
  GeneratorContext,
  GeneratorOperatorDescriptor,
  HarmonyPlan,
  NotePlan,
} from './types.js';

// ── chord-source (generators.md §5, §9.6) ───────────────────────────────────

export interface ChordSourceParams extends Record<string, unknown> {
  source: 'chord-track' | 'selection';
}

/**
 * Splits the current selection into per-beat segments and infers each
 * segment's pitch-class set from whatever melody notes start there — the
 * same approach as commands/generate-chords.ts's segmentSelection, adapted
 * to a GeneratorBounds-scoped request instead of a whole-selection beatRange.
 */
function segmentSelection(ctx: GeneratorContext, bounds: GeneratorBounds): HarmonyPlan['segments'] {
  const starts = [...new Set(ctx.notes.map((n) => n.startBeat))]
    .filter((startBeat) => startBeat >= bounds.time.startBeat && startBeat < bounds.time.endBeat)
    .sort((a, b) => a - b);
  return starts
    .map((startBeat, i) => {
      const endBeat = i + 1 < starts.length ? starts[i + 1] : bounds.time.endBeat;
      const pitchClasses = [
        ...new Set(
          ctx.notes
            .filter((n) => n.startBeat === startBeat)
            .map((n) => ((n.midiNote % 12) + 12) % 12),
        ),
      ];
      return { startBeat, endBeat, root: pitchClasses[0] ?? 0, quality: '', pitchClasses };
    })
    .filter((segment) => segment.pitchClasses.length > 0);
}

function segmentChordTrack(
  ctx: GeneratorContext,
  bounds: GeneratorBounds,
): HarmonyPlan['segments'] {
  return chordSegments(ctx.chordTrack, bounds.time.startBeat, bounds.time.endBeat).map(
    (segment) => ({
      startBeat: segment.startBeat,
      endBeat: segment.endBeat,
      root: segment.event.root,
      quality: segment.event.quality,
      pitchClasses: [...segment.pitchClasses],
    }),
  );
}

/** A harmony source (generators.md §9.6): chord-track segments, or a chord per beat inferred from the selection. */
export const chordSourceOperator: GeneratorOperatorDescriptor = {
  id: 'chord-source',
  version: 1,
  label: 'Chord source',
  role: 'source',
  inputs: {},
  outputs: { harmony: { kind: 'harmony' } },
  contextDependencies: ['chord-track', 'selection'],
  paramFields: [
    {
      key: 'source',
      label: 'Source',
      type: 'select',
      default: 'chord-track',
      options: [
        { value: 'chord-track', label: 'Chord track' },
        { value: 'selection', label: 'Selection' },
      ],
    },
  ],
  summary(params) {
    return params.source === 'selection' ? 'from selection' : 'from chord track';
  },
  getDefaultParams: () => ({ source: 'chord-track' }),
  process(ctx, _inputs, request) {
    const { bounds } = request;
    const segments =
      request.params.source === 'selection'
        ? segmentSelection(ctx, bounds)
        : segmentChordTrack(ctx, bounds);
    return {
      harmony: { kind: 'harmony', bounds, diagnostics: [], segments } satisfies HarmonyPlan,
    };
  },
};

// ── smooth-voicing (generators.md §9.6) ─────────────────────────────────────

export interface SmoothVoicingParams extends Record<string, unknown> {
  octaveRange: { min: number; max: number };
  voiceCount: number;
  velocity: number;
}

/** Reads an `octaveRange`-shaped param out of an untyped params bag, falling back to a sensible default rather than throwing on malformed recipe data. */
function asOctaveRange(value: unknown): { min: number; max: number } {
  if (value && typeof value === 'object' && 'min' in value && 'max' in value) {
    return { min: Number(value.min), max: Number(value.max) };
  }
  return { min: 3, max: 5 };
}

/** Voices each incoming harmony segment via voiceChord (music-theory/index.ts), carrying voice leading across segments. */
export const smoothVoicingOperator: GeneratorOperatorDescriptor = {
  id: 'smooth-voicing',
  version: 1,
  label: 'Smooth voicing',
  role: 'processor',
  inputs: { harmony: { kind: 'harmony' } },
  outputs: { events: { kind: 'events' } },
  paramFields: [
    {
      key: 'octaveRange',
      label: 'Octave range',
      type: 'number-range',
      min: 0,
      max: 8,
      default: { min: 3, max: 5 },
    },
    { key: 'voiceCount', label: 'Voices', type: 'number', min: 1, max: 6, step: 1, default: 4 },
    { key: 'velocity', label: 'Velocity', type: 'number', min: 1, max: 127, default: 80 },
  ],
  summary(params) {
    const range = asOctaveRange(params.octaveRange);
    return `${String(params.voiceCount)}v, oct ${String(range.min)}-${String(range.max)}`;
  },
  getDefaultParams: () => ({ octaveRange: { min: 3, max: 5 }, voiceCount: 4, velocity: 80 }),
  process(_ctx, inputs, request) {
    // Same defensive handling as operators.ts's pulse-render-notes: a
    // bypassed upstream with no passthrough can leave this input undefined.
    const plan = inputs.harmony as HarmonyPlan | undefined;
    const segments = plan?.segments ?? [];
    const { bounds, params } = request;
    const octaveRange = asOctaveRange(params.octaveRange);
    const voiceCount = Math.max(1, Math.round(Number(params.voiceCount ?? 4)));
    const velocity = clampVelocity(Number(params.velocity ?? 80));

    let previousVoicing: number[] | null = null;
    const events: EventPlan['events'] = [];
    for (const segment of segments) {
      if (segment.pitchClasses.length === 0) continue;
      const voicing = voiceChord(
        new Set(segment.pitchClasses),
        octaveRange,
        voiceCount,
        previousVoicing,
      );
      previousVoicing = voicing;
      if (voicing.length === 0) continue;
      events.push({
        startBeat: segment.startBeat,
        durationBeats: Math.max(MIN_DURATION_BEATS, segment.endBeat - segment.startBeat),
        pitches: voicing,
        velocity,
        role: 'support',
      });
    }
    return {
      events: { kind: 'events', bounds, diagnostics: [], events } satisfies EventPlan,
    };
  },
};

// ── event-render-notes (generators.md §5's "note renderer") ────────────────

export interface EventRenderNotesParams extends Record<string, unknown> {
  velocityVariation: number;
}

/** Expands an EventPlan's (possibly multi-pitch) events into individual GeneratedNoteDrafts — the generic terminal renderer for any 'events'-producing chain. */
export const eventRenderNotesOperator: GeneratorOperatorDescriptor = {
  id: 'event-render-notes',
  version: 1,
  label: 'Note renderer',
  role: 'renderer',
  inputs: { events: { kind: 'events' } },
  outputs: { notes: { kind: 'notes' } },
  variationDimensions: ['dynamics'],
  paramFields: [
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
    return `vel var ${String(Math.round(Number(params.velocityVariation) * 100))}%`;
  },
  getDefaultParams: () => ({ velocityVariation: 0 }),
  process(_ctx, inputs, request) {
    const plan = inputs.events as EventPlan | undefined;
    const events = plan?.events ?? [];
    const { bounds, variation, nodeId } = request;
    const velocityVariation = clampUnit(Number(request.params.velocityVariation ?? 0));

    const dynamicsSeed = deriveSeed(
      variation.seed,
      variation.locks.dynamics ? 0 : variation.generation,
      'dynamics',
      nodeId,
    );
    const random = createSeededRandom(dynamicsSeed);

    const notes: GeneratedNoteDraft[] = [];
    let i = 0;
    for (const event of events) {
      for (const midiNote of event.pitches) {
        const jitter =
          velocityVariation > 0 ? Math.round((random() * 2 - 1) * velocityVariation * 40) : 0;
        notes.push({
          eventKey: `${nodeId}:${String(i)}`,
          midiNote: clampToPitchBounds(clampMidi(midiNote), bounds),
          startBeat: event.startBeat,
          durationBeats: Math.max(MIN_DURATION_BEATS, event.durationBeats),
          velocity: clampVelocity(event.velocity + jitter),
          role: (event.role as GeneratedNoteDraft['role']) ?? 'support',
          sourceStep: i,
        });
        i++;
      }
    }
    notes.sort((a, b) => a.startBeat - b.startBeat || a.midiNote - b.midiNote);

    return {
      notes: { kind: 'notes', bounds, diagnostics: [], notes } satisfies NotePlan,
    };
  },
};
