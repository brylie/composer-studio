// Domain layer — scale and chord tracks (tracks.md), built on the generic
// event-track abstraction in timeline.ts.

import { pitchClassesForChordEvent, pitchClassesForScaleEvent } from '../music-theory/index.js';
import type { ChordEvent, ChordTrack, ScaleEvent, ScaleTrack } from './timeline.js';
import { eventSegments } from './timeline.js';

export interface ScaleSegment {
  startBeat: number;
  endBeat: number;
  event: ScaleEvent;
  scaleDegrees: Set<number>; // pitch classes 0–11
}

/**
 * Per-segment scale-degree highlighting (tracks.md#context-aware-highlighting).
 * More than one ScaleEvent can be active across [rangeStart, rangeEnd), so
 * this returns one segment per active event rather than a single globally
 * computed set — rows in-scale in one segment and out-of-scale in the next
 * must be able to visibly change at the segment boundary.
 */
export function scaleSegments(
  track: ScaleTrack,
  rangeStart: number,
  rangeEnd: number,
): ScaleSegment[] {
  return eventSegments(track, rangeStart, rangeEnd).map((segment) => ({
    startBeat: segment.startBeat,
    endBeat: segment.endBeat,
    event: segment.event,
    scaleDegrees: pitchClassesForScaleEvent(segment.event.root, segment.event.mode),
  }));
}

export interface ChordSegment {
  startBeat: number;
  endBeat: number;
  event: ChordEvent;
  pitchClasses: Set<number>; // pitch classes 0–11
}

/**
 * Per-segment chord pitch-classes, the chord-track mirror of scaleSegments
 * above (tracks.md#three-consumers-of-pitchclasses) — reused as-is by
 * generate-chords's `source: 'chord-track'` path (voicing input) and by
 * harmonySegments below (chord-tone highlighting/tension-checking).
 */
export function chordSegments(
  track: ChordTrack,
  rangeStart: number,
  rangeEnd: number,
): ChordSegment[] {
  return eventSegments(track, rangeStart, rangeEnd).map((segment) => ({
    startBeat: segment.startBeat,
    endBeat: segment.endBeat,
    event: segment.event,
    pitchClasses: pitchClassesForChordEvent(segment.event.root, segment.event.quality),
  }));
}

/**
 * Chord tones that fall outside the given scale — empty when the chord is
 * fully diatonic (tracks.md#three-consumers-of-pitchclasses, "tension
 * against the active scale"). Replaces the old binary isDiatonic flag with
 * the actual offending pitch classes, since "which notes clash" drives a
 * distinct visual treatment that "does it clash" alone can't.
 */
export function tensionPitchClasses(
  chordTones: ReadonlySet<number>,
  scaleDegrees: ReadonlySet<number>,
): Set<number> {
  const tension = new Set<number>();
  for (const pitchClass of chordTones) {
    if (!scaleDegrees.has(pitchClass)) tension.add(pitchClass);
  }
  return tension;
}

export interface HarmonySegment {
  startBeat: number;
  endBeat: number;
  scaleDegrees: Set<number>;
  /** null when no ChordEvent is active across this segment. */
  chordTones: Set<number> | null;
}

/**
 * Merges scale and chord segmentation into one set of segments for chord-tone
 * highlighting (tracks.md#three-consumers-of-pitchclasses, point 1):
 * "segment boundaries come from _both_ tracks' events, so a chord change
 * mid-scale-segment still produces a visible boundary." Each returned
 * segment carries both pitch-class sets so a consumer (NoteGrid) can
 * classify a row as chord-tone (strong highlight, layered on top),
 * scale-only (the existing lighter highlight), or neither.
 */
export function harmonySegments(
  scaleTrack: ScaleTrack,
  chordTrack: ChordTrack,
  rangeStart: number,
  rangeEnd: number,
): HarmonySegment[] {
  if (rangeEnd <= rangeStart) return [];

  const scale = scaleSegments(scaleTrack, rangeStart, rangeEnd);
  const chord = chordSegments(chordTrack, rangeStart, rangeEnd);

  const boundaries = new Set<number>([rangeStart, rangeEnd]);
  for (const segment of scale) {
    boundaries.add(segment.startBeat);
    boundaries.add(segment.endBeat);
  }
  for (const segment of chord) {
    boundaries.add(segment.startBeat);
    boundaries.add(segment.endBeat);
  }
  const sortedBoundaries = [...boundaries].sort((a, b) => a - b);

  const segments: HarmonySegment[] = [];
  for (let i = 0; i < sortedBoundaries.length - 1; i++) {
    const startBeat = sortedBoundaries[i];
    const endBeat = sortedBoundaries[i + 1];
    if (endBeat <= startBeat) continue;
    const midpoint = (startBeat + endBeat) / 2;
    const scaleSegment = scale.find((s) => s.startBeat <= midpoint && midpoint < s.endBeat);
    const chordSegment = chord.find((c) => c.startBeat <= midpoint && midpoint < c.endBeat);
    segments.push({
      startBeat,
      endBeat,
      scaleDegrees: scaleSegment?.scaleDegrees ?? new Set<number>(),
      chordTones: chordSegment?.pitchClasses ?? null,
    });
  }
  return segments;
}
