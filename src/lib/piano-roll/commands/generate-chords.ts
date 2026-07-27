import type { OctaveRange } from '../../music-theory/index.js';
import { voiceChord } from '../../music-theory/index.js';
import type { CommandContext, Note } from '../types.js';
import { clampNote } from '../types.js';
import type { CommandDescriptor } from './types.js';

export interface GenerateChordsParams extends Record<string, unknown> {
  octaveRange: OctaveRange;
  voiceCount: number;
  voicingStrategy: 'closed' | 'open' | 'drop2' | 'smooth-voice-leading';
  source: 'chord-track' | 'selection-derived';
  targetRange?: { min: number; max: number };
}

interface Segment {
  startBeat: number;
  endBeat: number;
  pitchClasses: Set<number>;
}

/**
 * Splits the current selection into per-beat segments and infers each
 * segment's pitch-class set directly from whatever melody notes start
 * there — the `source: 'selection-derived'` path (transformations.md):
 * "infer a chord per beat from whatever melody notes are selected".
 */
function segmentSelection(ctx: CommandContext): Segment[] {
  const beatRange = ctx.beatRange;
  if (!beatRange) return [];
  const starts = [...new Set(ctx.notes.map((n) => n.startBeat))].sort((a, b) => a - b);
  return starts.map((startBeat, i) => {
    const endBeat = i + 1 < starts.length ? starts[i + 1] : beatRange.end;
    const pitchClasses = new Set(
      ctx.notes.filter((n) => n.startBeat === startBeat).map((n) => ((n.midiNote % 12) + 12) % 12),
    );
    return { startBeat, endBeat, pitchClasses };
  });
}

const DEFAULT_VELOCITY = 80;

/**
 * Generates voice-led chord notes alongside a melody, without touching the
 * melody itself — the priority use case (roadmap.md Phase 2). Only
 * `source: 'selection-derived'` is implemented this phase; `'chord-track'`
 * is a type-compatible stub since the chord track doesn't exist until
 * Phase 7 (ctx.chordTrack is always []).
 */
export const generateChords: CommandDescriptor<GenerateChordsParams> = {
  id: 'generate-chords',
  category: 'generate',
  labelKey: 'commands.generateChords.label',
  icon: 'chord',
  params: [
    {
      key: 'octaveRange',
      label: 'Octave range',
      type: 'number-range',
      min: 0,
      max: 8,
      default: { min: 3, max: 5 },
    },
    { key: 'voiceCount', label: 'Voices', type: 'number', min: 1, max: 6, step: 1, default: 4 },
    {
      key: 'voicingStrategy',
      label: 'Voicing',
      type: 'select',
      default: 'smooth-voice-leading',
      options: [
        { value: 'closed', label: 'Closed' },
        { value: 'open', label: 'Open' },
        { value: 'drop2', label: 'Drop 2' },
        { value: 'smooth-voice-leading', label: 'Smooth voice leading' },
      ],
    },
    {
      key: 'source',
      label: 'Source',
      type: 'select',
      default: 'selection-derived',
      options: [
        { value: 'selection-derived', label: 'Selection-derived' },
        { value: 'chord-track', label: 'Chord track' },
      ],
    },
  ],
  isApplicable(ctx: CommandContext) {
    return ctx.count >= 1 && ctx.beatRange !== null;
  },
  getDisabledReasonKey() {
    return 'commands.disabled.selectAtLeastOne';
  },
  run(ctx: CommandContext, params: GenerateChordsParams) {
    const segments = params.source === 'selection-derived' ? segmentSelection(ctx) : [];

    let previousVoicing: number[] | null = null;
    const newNotes: Note[] = [];
    for (const segment of segments) {
      if (segment.pitchClasses.size === 0) continue;
      const voicing = voiceChord(
        segment.pitchClasses,
        params.octaveRange,
        params.voiceCount,
        previousVoicing,
      );
      previousVoicing = voicing;
      for (const midiNote of voicing) {
        newNotes.push(
          clampNote({
            id: crypto.randomUUID(),
            midiNote,
            startBeat: segment.startBeat,
            durationBeats: Math.max(segment.endBeat - segment.startBeat, 1 / 64),
            velocity: DEFAULT_VELOCITY,
          }),
        );
      }
    }

    return {
      notes: [...ctx.allNotes, ...newNotes],
      label: 'Generate chords',
    };
  },
};
