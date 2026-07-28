import { describe, expect, it } from 'vitest';
import type { ChordTrack, ScaleTrack } from './timeline.js';
import { chordSegments, harmonySegments, scaleSegments, tensionPitchClasses } from './tracks.js';

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

describe('chordSegments', () => {
  it('returns a single segment for a range entirely within one chord', () => {
    const track: ChordTrack = [{ id: 'a', beat: 0, root: 0, quality: 'maj7' }];
    const segments = chordSegments(track, 4, 12);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ startBeat: 4, endBeat: 12 });
    expect(segments[0].pitchClasses).toEqual(new Set([0, 4, 7, 11])); // Cmaj7
  });

  it('produces one segment per chord crossed by the range, each with its own pitch-class set', () => {
    const track: ChordTrack = [
      { id: 'a', beat: 0, root: 0, quality: 'maj' }, // C major triad
      { id: 'b', beat: 8, root: 7, quality: '7' }, // G dominant 7th
    ];
    const segments = chordSegments(track, 4, 12);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ startBeat: 4, endBeat: 8 });
    expect(segments[0].pitchClasses).toEqual(new Set([0, 4, 7]));
    expect(segments[1]).toMatchObject({ startBeat: 8, endBeat: 12 });
    expect(segments[1].pitchClasses).toEqual(new Set([7, 11, 2, 5])); // G, B, D, F
  });

  it('returns an empty array when the range precedes the first chord event', () => {
    const track: ChordTrack = [{ id: 'a', beat: 10, root: 0, quality: 'maj' }];
    expect(chordSegments(track, 0, 5)).toEqual([]);
  });

  it('returns an empty array for an empty chord track', () => {
    expect(chordSegments([], 0, 16)).toEqual([]);
  });
});

describe('tensionPitchClasses', () => {
  it('returns an empty set when the chord is fully diatonic', () => {
    const scaleDegrees = new Set([0, 2, 4, 5, 7, 9, 11]); // C major
    const chordTones = new Set([0, 4, 7]); // C major triad — fully diatonic
    expect(tensionPitchClasses(chordTones, scaleDegrees)).toEqual(new Set());
  });

  it('returns exactly the chord tones that fall outside the scale', () => {
    const scaleDegrees = new Set([0, 2, 4, 5, 7, 9, 11]); // C major
    const chordTones = new Set([1, 5, 8]); // C# major triad — entirely non-diatonic except F(5)
    expect(tensionPitchClasses(chordTones, scaleDegrees)).toEqual(new Set([1, 8]));
  });

  it('returns an empty set for an empty chord', () => {
    expect(tensionPitchClasses(new Set(), new Set([0, 2, 4]))).toEqual(new Set());
  });
});

describe('harmonySegments', () => {
  it('carries scaleDegrees with a null chordTones when no chord events exist', () => {
    const scaleTrack: ScaleTrack = [{ id: 'a', beat: 0, root: 0, mode: 'major' }];
    const segments = harmonySegments(scaleTrack, [], 0, 8);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ startBeat: 0, endBeat: 8, chordTones: null });
    expect(segments[0].scaleDegrees).toEqual(new Set([0, 2, 4, 5, 7, 9, 11]));
  });

  it('returns one empty segment spanning the range when neither track has events', () => {
    const segments = harmonySegments([], [], 0, 8);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ startBeat: 0, endBeat: 8, chordTones: null });
    expect(segments[0].scaleDegrees).toEqual(new Set());
  });

  it('splits a scale segment at a chord change that lands mid-segment', () => {
    const scaleTrack: ScaleTrack = [{ id: 's1', beat: 0, root: 0, mode: 'major' }]; // C major, 0..16
    const chordTrack: ChordTrack = [{ id: 'c1', beat: 4, root: 0, quality: 'maj7' }]; // Cmaj7 from beat 4
    const segments = harmonySegments(scaleTrack, chordTrack, 0, 16);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ startBeat: 0, endBeat: 4, chordTones: null });
    expect(segments[0].scaleDegrees).toEqual(new Set([0, 2, 4, 5, 7, 9, 11]));
    expect(segments[1]).toMatchObject({ startBeat: 4, endBeat: 16 });
    expect(segments[1].scaleDegrees).toEqual(new Set([0, 2, 4, 5, 7, 9, 11]));
    expect(segments[1].chordTones).toEqual(new Set([0, 4, 7, 11]));
  });

  it('returns an empty array when rangeEnd <= rangeStart', () => {
    expect(harmonySegments([], [], 8, 8)).toEqual([]);
    expect(harmonySegments([], [], 8, 4)).toEqual([]);
  });
});
