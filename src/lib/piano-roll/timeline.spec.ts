import { describe, expect, it } from 'vitest';
import type { ScaleEvent, ScaleTrack, TimeSignatureEvent } from './timeline.js';
import { activeEventAt, barBeats, eventSegments, removeEvent, upsertEvent } from './timeline.js';

function scaleEvent(id: string, beat: number, root = 0, mode = 'major'): ScaleEvent {
  return { id, beat, root, mode };
}

// ── activeEventAt ────────────────────────────────────────────────────────────

describe('activeEventAt', () => {
  it('returns undefined for an empty track', () => {
    expect(activeEventAt<ScaleEvent>([], 4)).toBeUndefined();
  });

  it('returns undefined when beat is before the first event', () => {
    const track: ScaleTrack = [scaleEvent('a', 4)];
    expect(activeEventAt(track, 0)).toBeUndefined();
  });

  it('returns the last event with beat <= the queried beat', () => {
    const track: ScaleTrack = [scaleEvent('a', 0), scaleEvent('b', 8), scaleEvent('c', 16)];
    expect(activeEventAt(track, 0)?.id).toBe('a');
    expect(activeEventAt(track, 5)?.id).toBe('a');
    expect(activeEventAt(track, 8)?.id).toBe('b');
    expect(activeEventAt(track, 15.9)?.id).toBe('b');
    expect(activeEventAt(track, 16)?.id).toBe('c');
    expect(activeEventAt(track, 1000)?.id).toBe('c');
  });
});

// ── upsertEvent / removeEvent ────────────────────────────────────────────────

describe('upsertEvent', () => {
  it('inserts into an empty track', () => {
    const track = upsertEvent<ScaleEvent>([], scaleEvent('a', 4));
    expect(track).toEqual([scaleEvent('a', 4)]);
  });

  it('keeps the track sorted by beat regardless of insertion order', () => {
    let track: ScaleTrack = [];
    track = upsertEvent(track, scaleEvent('c', 16));
    track = upsertEvent(track, scaleEvent('a', 0));
    track = upsertEvent(track, scaleEvent('b', 8));
    expect(track.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('replaces (does not stack) an event already at the same beat', () => {
    let track: ScaleTrack = [scaleEvent('a', 4, 0, 'major')];
    track = upsertEvent(track, scaleEvent('b', 4, 9, 'aeolian'));
    expect(track).toHaveLength(1);
    expect(track[0]).toEqual(scaleEvent('b', 4, 9, 'aeolian'));
  });

  it('does not mutate the input array', () => {
    const original: ScaleTrack = [scaleEvent('a', 0)];
    upsertEvent(original, scaleEvent('b', 4));
    expect(original).toHaveLength(1);
  });
});

describe('removeEvent', () => {
  it('removes the event with the matching id', () => {
    const track: ScaleTrack = [scaleEvent('a', 0), scaleEvent('b', 4)];
    expect(removeEvent(track, 'a')).toEqual([scaleEvent('b', 4)]);
  });

  it('is a no-op when the id is not found', () => {
    const track: ScaleTrack = [scaleEvent('a', 0)];
    expect(removeEvent(track, 'missing')).toEqual(track);
  });
});

// ── eventSegments ─────────────────────────────────────────────────────────────

describe('eventSegments', () => {
  it('returns an empty array for an empty track', () => {
    expect(eventSegments([], 0, 16)).toEqual([]);
  });

  it('returns an empty array when the range is empty or inverted', () => {
    const track: ScaleTrack = [scaleEvent('a', 0)];
    expect(eventSegments(track, 8, 8)).toEqual([]);
    expect(eventSegments(track, 8, 4)).toEqual([]);
  });

  it('carries in the event active before the range when the range contains no event of its own', () => {
    const track: ScaleTrack = [scaleEvent('a', 0)];
    const segments = eventSegments(track, 20, 30);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ startBeat: 20, endBeat: 30, event: track[0] });
  });

  it('returns nothing when the range starts before any event exists', () => {
    const track: ScaleTrack = [scaleEvent('a', 10)];
    expect(eventSegments(track, 0, 5)).toEqual([]);
  });

  it('produces one segment per event spanning the range, clamped to the range bounds', () => {
    const track: ScaleTrack = [scaleEvent('a', 0), scaleEvent('b', 8), scaleEvent('c', 16)];
    const segments = eventSegments(track, 4, 20);
    expect(segments).toEqual([
      { startBeat: 4, endBeat: 8, event: track[0] }, // carried-in, clamped to range start
      { startBeat: 8, endBeat: 16, event: track[1] },
      { startBeat: 16, endBeat: 20, event: track[2] }, // clamped to range end
    ]);
  });

  it('does not double-count the carried-in event when it also falls inside the range', () => {
    const track: ScaleTrack = [scaleEvent('a', 0)];
    const segments = eventSegments(track, 0, 8);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ startBeat: 0, endBeat: 8, event: track[0] });
  });
});

// ── barBeats ─────────────────────────────────────────────────────────────────

describe('barBeats', () => {
  it('falls back to an implicit 4/4 grid for an empty track', () => {
    expect(barBeats([], 12)).toEqual([0, 4, 8]);
  });

  it('produces bar-start beats every 4 beats for a single 4/4 event', () => {
    const track: TimeSignatureEvent[] = [{ id: 'a', beat: 0, numerator: 4, denominator: 4 }];
    expect(barBeats(track, 16)).toEqual([0, 4, 8, 12]);
  });

  it('produces bar-start beats every 3 beats for 3/4', () => {
    const track: TimeSignatureEvent[] = [{ id: 'a', beat: 0, numerator: 3, denominator: 4 }];
    expect(barBeats(track, 9)).toEqual([0, 3, 6]);
  });

  it('handles a mid-timeline meter change', () => {
    const track: TimeSignatureEvent[] = [
      { id: 'a', beat: 0, numerator: 4, denominator: 4 },
      { id: 'b', beat: 8, numerator: 3, denominator: 4 },
    ];
    // First section: bars at 0, 4 (up to beat 8). Second section: bars at 8, 11 (up to 14).
    expect(barBeats(track, 14)).toEqual([0, 4, 8, 11]);
  });

  it('handles 6/8 (beatsPerBar = 3)', () => {
    const track: TimeSignatureEvent[] = [{ id: 'a', beat: 0, numerator: 6, denominator: 8 }];
    expect(barBeats(track, 9)).toEqual([0, 3, 6]);
  });
});
