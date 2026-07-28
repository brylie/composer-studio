// Domain layer — scale track (tracks.md), built on the generic event-track
// abstraction in timeline.ts. Chord/labels/arranger tracks are out of scope
// until Phase 7+ (roadmap.md), but reuse eventSegments the same way this
// module does — this is the shape a future chordSegments() would follow.

import { pitchClassesForScaleEvent } from '../music-theory/index.js';
import type { ScaleEvent, ScaleTrack } from './timeline.js';
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
