import { describe, expect, it } from 'vitest';
import {
  pitchClassesForChord,
  pitchClassesForScale,
  pitchClassesForScaleEvent,
  voiceChord,
} from './index.js';

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

describe('pitchClassesForScaleEvent', () => {
  it('matches pitchClassesForScale for an equivalent numeric root', () => {
    expect(pitchClassesForScaleEvent(0, 'major')).toEqual(pitchClassesForScale('C', 'major'));
    expect(pitchClassesForScaleEvent(9, 'aeolian')).toEqual(pitchClassesForScale('A', 'aeolian'));
  });

  it('normalizes out-of-range pitch classes (negative and >11)', () => {
    expect(pitchClassesForScaleEvent(12, 'major')).toEqual(pitchClassesForScale('C', 'major'));
    expect(pitchClassesForScaleEvent(-1, 'major')).toEqual(pitchClassesForScale('B', 'major'));
  });
});

// Every scale name offered by ScaleEventEditor.svelte's MODE_GROUPS picker —
// duplicated here (not imported from the .svelte file) so a typo'd tonal.js
// scale name is caught as a failing domain test instead of silently
// resolving to an empty pitch-class set with no error at the UI layer.
const CURATED_SCALE_NAMES = [
  'major',
  'dorian',
  'phrygian',
  'lydian',
  'mixolydian',
  'aeolian',
  'locrian',
  'harmonic minor',
  'melodic minor',
  'major pentatonic',
  'minor pentatonic',
  'blues',
  'whole tone',
  'hungarian minor',
  'phrygian dominant',
  'double harmonic major',
  'hirajoshi',
  'enigmatic',
];

describe('curated scale names (ScaleEventEditor.svelte MODE_GROUPS)', () => {
  it.each(CURATED_SCALE_NAMES)('%s resolves to a non-empty pitch-class set', (name) => {
    expect(pitchClassesForScale('C', name).size).toBeGreaterThan(0);
  });

  it('major pentatonic has 5 notes', () => {
    expect(pitchClassesForScale('C', 'major pentatonic')).toEqual(new Set([0, 2, 4, 7, 9]));
  });

  it('minor pentatonic has 5 notes', () => {
    expect(pitchClassesForScale('C', 'minor pentatonic')).toEqual(new Set([0, 3, 5, 7, 10]));
  });

  it('whole tone has 6 notes, evenly spaced by a whole step', () => {
    expect(pitchClassesForScale('C', 'whole tone')).toEqual(new Set([0, 2, 4, 6, 8, 10]));
  });

  it('hirajoshi (Japanese pentatonic) has 5 notes', () => {
    expect(pitchClassesForScale('C', 'hirajoshi')).toEqual(new Set([0, 2, 3, 7, 8]));
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

  it('never emits duplicate MIDI values, even when top-voice octave smoothing would collide with another voice', () => {
    // Candidates (chroma 0, C) in a { min: 3, max: 5 } range: 48, 60, 72.
    // previousVoicing = [59, 61] forces the greedy pass to assign 60 to the
    // lower voice and 72 to the top voice (its true nearest candidate, 60,
    // is already taken). The octave-down alternative for the top voice (60)
    // would then collide with the already-assigned lower voice, and
    // topNoteDiff would prefer it (61 is much closer to 60 than to 72) —
    // exercising the duplicate-avoidance guard.
    const voicing = voiceChord(new Set([0]), { min: 3, max: 5 }, 2, [59, 61]);
    expect(new Set(voicing).size).toBe(voicing.length);
    expect(voicing).toEqual([60, 72]);
  });
});
