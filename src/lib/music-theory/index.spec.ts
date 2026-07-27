import { describe, expect, it } from 'vitest';
import { pitchClassesForChord, pitchClassesForScale, voiceChord } from './index.js';

describe('pitchClassesForScale', () => {
  it('returns C major pitch classes', () => {
    const classes = pitchClassesForScale('C', 'major');
    expect(classes).toEqual(new Set([0, 2, 4, 5, 7, 9, 11]));
  });

  it('returns A minor (aeolian) pitch classes', () => {
    const classes = pitchClassesForScale('A', 'aeolian');
    expect(classes).toEqual(new Set([9, 11, 0, 2, 4, 5, 7]));
  });
});

describe('pitchClassesForChord', () => {
  it('returns Cmaj7 pitch classes', () => {
    const classes = pitchClassesForChord('C', 'maj7');
    expect(classes).toEqual(new Set([0, 4, 7, 11]));
  });

  it('returns Dm7 pitch classes', () => {
    const classes = pitchClassesForChord('D', 'm7');
    expect(classes).toEqual(new Set([2, 5, 9, 0]));
  });
});

describe('voiceChord', () => {
  it('returns an empty array for an empty pitch-class set', () => {
    expect(voiceChord(new Set(), { min: 3, max: 5 }, 4, null)).toEqual([]);
  });

  it('returns an empty array when voiceCount is 0', () => {
    expect(voiceChord(new Set([0, 4, 7]), { min: 3, max: 5 }, 0, null)).toEqual([]);
  });

  it('voices a first chord in closed position within the octave range', () => {
    const voicing = voiceChord(new Set([0, 4, 7]), { min: 3, max: 5 }, 3, null);
    expect(voicing).toHaveLength(3);
    for (const midi of voicing) {
      expect([0, 4, 7]).toContain(midi % 12);
      expect(midi).toBeGreaterThanOrEqual(12 * (3 + 1));
      expect(midi).toBeLessThanOrEqual(12 * (5 + 2) - 1);
    }
    // sorted ascending
    expect(voicing).toEqual([...voicing].sort((a, b) => a - b));
  });

  it('smooths voice leading against a previous voicing (small total movement)', () => {
    const first = voiceChord(new Set([0, 4, 7]), { min: 3, max: 5 }, 3, null); // C major
    const second = voiceChord(new Set([5, 9, 0]), { min: 3, max: 5 }, 3, first); // F major
    expect(second).toHaveLength(3);
    for (const midi of second) {
      expect([5, 9, 0]).toContain(midi % 12);
    }
    // Total absolute movement between consecutive same-length voicings should be modest,
    // not a full-range jump — sanity bound rather than an exact expected value.
    const totalMovement = first.reduce((sum, note, i) => sum + Math.abs(note - second[i]), 0);
    expect(totalMovement).toBeLessThan(24);
  });

  it('falls back to fewer notes when the range has fewer distinct candidates than voiceCount', () => {
    const voicing = voiceChord(new Set([0]), { min: 4, max: 4 }, 3, null);
    // Only one distinct MIDI candidate (chroma 0) exists in a single-octave range,
    // so the result must be exactly that one note — not the final candidate duplicated.
    expect(voicing).toHaveLength(1);
    expect(new Set(voicing).size).toBe(voicing.length);
  });

  it('pads a shorter previous voicing (fewer voices than requested) before smoothing', () => {
    const shortPrevious = [60]; // only 1 previous voice, but requesting 3 now
    const voicing = voiceChord(new Set([0, 4, 7]), { min: 3, max: 5 }, 3, shortPrevious);
    expect(voicing).toHaveLength(3);
  });

  it('returns fewer notes than voiceCount when a smoothed voicing runs out of candidates', () => {
    const previous = [48, 52, 55]; // 3-voice previous chord
    // Only one distinct MIDI candidate (chroma 0) exists in this single-octave range,
    // so the greedy assignment pool empties after the first voice is assigned.
    const voicing = voiceChord(new Set([0]), { min: 4, max: 4 }, 3, previous);
    expect(voicing).toHaveLength(1);
  });
});
