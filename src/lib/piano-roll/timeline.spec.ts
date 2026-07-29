import { describe, expect, it } from 'vitest';
import type { ScaleEvent, ScaleTrack, TimeSignatureEvent } from './timeline.js';
import {
  activeEventAt,
  barBeats,
  beatGroupLines,
  eventSegments,
  removeEvent,
  upsertEvent,
} from './timeline.js';

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

// ── beatGroupLines ───────────────────────────────────────────────────────────

describe('beatGroupLines', () => {
  it('v1 fallback (no groups): 4/4 gets 3 evenly-spaced internal quarter-beat ticks', () => {
    const sig: TimeSignatureEvent = { id: 'a', beat: 0, numerator: 4, denominator: 4 };
    expect(beatGroupLines(sig, 0)).toEqual([1, 2, 3]);
  });

  it('v1 fallback: 3/4 gets 2 internal ticks', () => {
    const sig: TimeSignatureEvent = { id: 'a', beat: 0, numerator: 3, denominator: 4 };
    expect(beatGroupLines(sig, 0)).toEqual([1, 2]);
  });

  it('offsets ticks by barStart for a bar that does not start at beat 0', () => {
    const sig: TimeSignatureEvent = { id: 'a', beat: 8, numerator: 4, denominator: 4 };
    expect(beatGroupLines(sig, 8)).toEqual([9, 10, 11]);
  });

  it('produces no ticks for a single-unit numerator (nothing to subdivide)', () => {
    const sig: TimeSignatureEvent = { id: 'a', beat: 0, numerator: 1, denominator: 4 };
    expect(beatGroupLines(sig, 0)).toEqual([]);
  });

  it('honors an explicit v2 additive grouping instead of the numerator fallback', () => {
    const sig: TimeSignatureEvent = {
      id: 'a',
      beat: 0,
      numerator: 7,
      denominator: 8,
      groups: [3, 2, 2],
    };
    // unit = 4/8 = 0.5 beat; groups [3,2,2] -> ticks after 3 and 5 eighths.
    expect(beatGroupLines(sig, 0)).toEqual([1.5, 2.5]);
  });

  it('never produces a line at the bar end — barBeats already draws that boundary', () => {
    const sig: TimeSignatureEvent = { id: 'a', beat: 0, numerator: 6, denominator: 8 };
    const lines = beatGroupLines(sig, 0);
    expect(lines.every((beat) => beat < 3)).toBe(true);
  });

  it("clips ticks to an explicit barEnd shorter than the signature's own nominal bar length", () => {
    // A 4/4 bar truncated to just 1 beat (e.g. a new signature placed at
    // beat 1, mid-bar) must not still compute the untruncated 1/2/3 ticks —
    // none of them fit inside the actual [0, 1) bar.
    const sig: TimeSignatureEvent = { id: 'a', beat: 0, numerator: 4, denominator: 4 };
    expect(beatGroupLines(sig, 0, 1)).toEqual([]);
  });

  it("regression: a mid-bar signature change does not produce ticks that collide with the next bar's own ticks", () => {
    // This is exactly tracks.md's motivating scenario reproduced as a unit
    // test: a 3/4 marker placed at beat 1 truncates the preceding 4/4 bar
    // to [0, 1). Without barEnd clipping, the truncated bar's unclipped
    // ticks (1, 2, 3) collide with the next bar's own ticks (2, 3) — two
    // different bars producing identical beat values, which crashes the
    // note grid's keyed `{#each}` (Svelte's each_key_duplicate) once fed
    // into a single flat list, as store.svelte.ts's beatGroupLinePositions
    // does.
    const barZeroTicks = beatGroupLines(
      { id: 'a', beat: 0, numerator: 4, denominator: 4 },
      0,
      1, // next bar starts at beat 1
    );
    const barOneTicks = beatGroupLines(
      { id: 'b', beat: 1, numerator: 3, denominator: 4 },
      1,
      4, // next bar starts at beat 4
    );
    const allTicks = [...barZeroTicks, ...barOneTicks];
    expect(new Set(allTicks).size).toBe(allTicks.length);
  });
});
