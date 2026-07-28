import { describe, expect, it } from 'vitest';
import type { ScaleTrack } from './timeline.js';
import { scaleSegments } from './tracks.js';

describe('scaleSegments', () => {
  it('returns a single segment for a selection entirely within one scale', () => {
    const track: ScaleTrack = [{ id: 'a', beat: 0, root: 0, mode: 'major' }];
    const segments = scaleSegments(track, 4, 12);
    expect(segments).toHaveLength(1);
    expect(segments[0].startBeat).toBe(4);
    expect(segments[0].endBeat).toBe(12);
    expect(segments[0].scaleDegrees).toEqual(new Set([0, 2, 4, 5, 7, 9, 11])); // C major
  });

  it('produces one segment per scale crossed by the range, each with its own pitch-class set', () => {
    const track: ScaleTrack = [
      { id: 'a', beat: 0, root: 0, mode: 'major' }, // C major
      { id: 'b', beat: 8, root: 9, mode: 'aeolian' }, // A minor
    ];
    const segments = scaleSegments(track, 4, 12);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ startBeat: 4, endBeat: 8 });
    expect(segments[0].scaleDegrees).toEqual(new Set([0, 2, 4, 5, 7, 9, 11]));
    expect(segments[1]).toMatchObject({ startBeat: 8, endBeat: 12 });
    expect(segments[1].scaleDegrees).toEqual(new Set([9, 11, 0, 2, 4, 5, 7]));
  });

  it('returns an empty array when the range precedes the first scale event', () => {
    const track: ScaleTrack = [{ id: 'a', beat: 10, root: 0, mode: 'major' }];
    expect(scaleSegments(track, 0, 5)).toEqual([]);
  });

  it('returns an empty array for an empty scale track', () => {
    expect(scaleSegments([], 0, 16)).toEqual([]);
  });
});
