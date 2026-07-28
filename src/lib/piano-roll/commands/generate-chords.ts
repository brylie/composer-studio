import type { OctaveRange } from '../../music-theory/index.js';
import { voiceChord } from '../../music-theory/index.js';
import { chordSegments } from '../tracks.js';
import type { CommandContext, Note } from '../types.js';
import { clampNote } from '../types.js';
import type { CommandDescriptor } from './types.js';

export interface GenerateChordsParams extends Record<string, unknown> {
  octaveRange: OctaveRange;
  voiceCount: number;
  /**
   * Only 'smooth-voice-leading' (voiceChord's actual behavior: closed voicing
   * for the first chord, nearest-neighbor voice leading thereafter) is
   * implemented this phase. 'open'/'drop2'/plain 'closed' voicing strategies
   * are deferred to a later phase.
   */
  voicingStrategy: 'smooth-voice-leading';
  source: 'chord-track' | 'selection-derived';
  /**
   * Beats — required (in spirit) for `source: 'chord-track'`, since that
   * mode's whole point is running with no melody selected (there's no
   * ctx.beatRange to fall back on). Ignored for `'selection-derived'`,
   * which uses the selection's own range. Falls back to a sensible span
   * from ctx.playhead (transformations.md) when omitted.
   */
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

const DEFAULT_TARGET_SPAN_BEATS = 4;

/**
 * Reads the chord track directly (`source: 'chord-track'`, tracks.md): one
 * segment per active ChordEvent across the target range, using its
 * `pitchClasses` — not the `quality` label — the same per-segment approach
 * scale-aware highlighting uses (tracks.ts's chordSegments, shared as-is).
 */
function segmentChordTrack(
  ctx: CommandContext,
  targetRange?: { min: number; max: number },
): Segment[] {
  const start = targetRange?.min ?? ctx.playhead;
  const end = targetRange?.max ?? ctx.playhead + DEFAULT_TARGET_SPAN_BEATS;
  return chordSegments(ctx.chordTrack, start, end).map((segment) => ({
    startBeat: segment.startBeat,
    endBeat: segment.endBeat,
    pitchClasses: segment.pitchClasses,
  }));
}

const DEFAULT_VELOCITY = 80;

/**
 * Generates voice-led chord notes alongside a melody, without touching the
 * melody itself — the priority use case (roadmap.md Phase 2). Two source
 * modes: `'selection-derived'` infers a chord per beat from whatever melody
 * notes are selected; `'chord-track'` (Phase 7) reads ctx.chordTrack
 * directly via activeEventAt/chordSegments, voicing its pitch classes
 * within `params.targetRange` — useful with no melody selected at all.
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
      options: [{ value: 'smooth-voice-leading', label: 'Smooth voice leading' }],
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
    {
      key: 'targetRange',
      label: 'Target range (beats)',
      type: 'number-range',
      min: 0,
      max: 256,
      default: { min: 0, max: 4 },
      // Seeds the drawer relative to the current playhead rather than
      // always {0, 4} — matches run()'s own fallback in segmentChordTrack,
      // so opening the drawer from the ribbon doesn't silently pin every
      // run to beat 0.
      getDefault: (ctx) => ({
        min: ctx.playhead,
        max: ctx.playhead + DEFAULT_TARGET_SPAN_BEATS,
      }),
      showIf: (values) => values.source === 'chord-track',
    },
  ],
  isApplicable(ctx: CommandContext) {
    // Selection-derived mode needs a selection; chord-track mode needs
    // events on the chord track. Either is enough to make the command
    // worth offering — the params drawer's `source` choice decides which
    // path run() actually takes.
    return (ctx.count >= 1 && ctx.beatRange !== null) || ctx.chordTrack.length > 0;
  },
  getDisabledReasonKey() {
    return 'commands.disabled.selectAtLeastOne';
  },
  run(ctx: CommandContext, params: GenerateChordsParams) {
    const segments =
      params.source === 'selection-derived'
        ? segmentSelection(ctx)
        : segmentChordTrack(ctx, params.targetRange);

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
