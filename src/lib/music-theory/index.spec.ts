import { describe, expect, it } from 'vitest';
import {
  commonTimeSignatures,
  nearestScaleTone,
  notesInPitchClassRange,
  parseTimeSignature,
  pitchClassesForChord,
  pitchClassesForScale,
  pitchClassesForScaleEvent,
  scaleDegreeToMidi,
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

// ── Time signatures (tracks.md#time-signature-track-specified) ─────────────

describe('commonTimeSignatures', () => {
  it('returns the v1 preset list, filtered and ordered per tracks.md', () => {
    expect(commonTimeSignatures()).toEqual([
      { numerator: 4, denominator: 4, label: '4/4' },
      { numerator: 3, denominator: 4, label: '3/4' },
      { numerator: 2, denominator: 4, label: '2/4' },
      { numerator: 2, denominator: 2, label: '2/2' },
      { numerator: 6, denominator: 8, label: '6/8' },
      { numerator: 9, denominator: 8, label: '9/8' },
      { numerator: 12, denominator: 8, label: '12/8' },
      { numerator: 5, denominator: 4, label: '5/4' },
      { numerator: 7, denominator: 8, label: '7/8' },
    ]);
  });
});

describe('parseTimeSignature', () => {
  it('parses simple signatures', () => {
    expect(parseTimeSignature('3/4')).toEqual({ numerator: 3, denominator: 4 });
    expect(parseTimeSignature('4/4')).toEqual({ numerator: 4, denominator: 4 });
  });

  it('parses compound signatures', () => {
    expect(parseTimeSignature('6/8')).toEqual({ numerator: 6, denominator: 8 });
  });

  it('parses additive signatures, deriving numerator from the sum of groups', () => {
    expect(parseTimeSignature('3+2+2/8')).toEqual({
      numerator: 7,
      denominator: 8,
      groups: [3, 2, 2],
    });
  });

  it('returns null for a malformed string tonal itself throws on', () => {
    expect(parseTimeSignature('not a time signature')).toBeNull();
    expect(parseTimeSignature('')).toBeNull();
  });

  it('rejects a non-power-of-two denominator', () => {
    expect(parseTimeSignature('3/5')).toBeNull();
  });
});

describe('notesInPitchClassRange', () => {
  it('returns every MIDI note in range whose pitch class is in the set', () => {
    const cMajor = pitchClassesForScale('C', 'major');
    expect(notesInPitchClassRange(cMajor, 60, 72)).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
  });

  it('returns an empty array for an empty pitch-class set', () => {
    expect(notesInPitchClassRange(new Set(), 60, 72)).toEqual([]);
  });

  it('returns an empty array when minMidi > maxMidi', () => {
    expect(notesInPitchClassRange(new Set([0]), 72, 60)).toEqual([]);
  });
});

describe('nearestScaleTone', () => {
  it('returns the note itself when it is already a scale tone', () => {
    expect(nearestScaleTone(0, 'major', 64, 'up')).toBe(64); // E4, in C major
  });

  it('steps up to the next scale tone', () => {
    expect(nearestScaleTone(0, 'major', 66, 'up')).toBe(67); // F#4 -> G4 in C major
  });

  it('steps down to the previous scale tone', () => {
    expect(nearestScaleTone(0, 'major', 66, 'down')).toBe(65); // F#4 -> F4 in C major
  });

  it('returns null for an invalid scale name', () => {
    expect(nearestScaleTone(0, 'not-a-real-scale', 60, 'up')).toBeNull();
  });
});

describe('scaleDegreeToMidi', () => {
  it('returns the nearest scale tone at degree 0', () => {
    expect(scaleDegreeToMidi(0, 'major', 0, 60)).toBe(60); // C4 already in C major
  });

  it('steps up through successive scale degrees', () => {
    // C major from C4: degree 1 -> D4, degree 2 -> E4
    expect(scaleDegreeToMidi(0, 'major', 1, 60)).toBe(62);
    expect(scaleDegreeToMidi(0, 'major', 2, 60)).toBe(64);
  });

  it('steps down through successive scale degrees', () => {
    expect(scaleDegreeToMidi(0, 'major', -1, 60)).toBe(59); // C4 -> B3
  });

  it('crosses octave boundaries correctly', () => {
    // C major has 7 degrees; 7 steps up from C4 lands on C5.
    expect(scaleDegreeToMidi(0, 'major', 7, 60)).toBe(72);
  });

  it('is the inverse of itself in the opposite direction', () => {
    const up = scaleDegreeToMidi(0, 'major', 3, 60);
    expect(scaleDegreeToMidi(0, 'major', -3, up ?? 0)).toBe(60);
  });

  it('returns null for an invalid scale name', () => {
    expect(scaleDegreeToMidi(0, 'not-a-real-scale', 1, 60)).toBeNull();
  });
});
