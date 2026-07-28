import { describe, expect, it } from 'vitest';
import { generateChords } from './generate-chords.js';
import { makeCommandContext, makeNote, runCommand } from './test-helpers.js';

describe('generateChords', () => {
  it('is not applicable with an empty selection', () => {
    const ctx = makeCommandContext([], new Set());
    expect(generateChords.isApplicable(ctx)).toBe(false);
  });

  it('exposes a disabled-reason key for the empty-selection case', () => {
    const ctx = makeCommandContext([], new Set());
    expect(generateChords.getDisabledReasonKey?.(ctx)).toBe('commands.disabled.selectAtLeastOne');
  });

  it('is not applicable when count >= 1 but beatRange is null (defensive branch)', () => {
    const ctx = { ...makeCommandContext([], new Set()), count: 1, beatRange: null };
    expect(generateChords.isApplicable(ctx)).toBe(false);
  });

  it('run() with an empty selection produces no chord notes (segmentSelection short-circuit)', () => {
    const ctx = makeCommandContext([], new Set());
    const result = runCommand(generateChords, ctx, {
      octaveRange: { min: 3, max: 5 },
      voiceCount: 3,
      voicingStrategy: 'smooth-voice-leading',
      source: 'selection-derived',
    });
    expect(result.notes).toEqual([]);
  });

  it('adds new chord notes without touching the selected melody notes', () => {
    const melody = [
      makeNote({ id: 'm1', startBeat: 0, durationBeats: 1, midiNote: 60 }), // C
      makeNote({ id: 'm2', startBeat: 1, durationBeats: 1, midiNote: 67 }), // G
    ];
    const ctx = makeCommandContext(melody, new Set(['m1', 'm2']));
    const result = runCommand(generateChords, ctx, {
      octaveRange: { min: 3, max: 5 },
      voiceCount: 3,
      voicingStrategy: 'smooth-voice-leading',
      source: 'selection-derived',
    });

    // Melody notes are preserved unchanged.
    expect(result.notes.find((n) => n.id === 'm1')).toEqual(melody[0]);
    expect(result.notes.find((n) => n.id === 'm2')).toEqual(melody[1]);

    // New chord notes were added (not replacing melody).
    const chordNotes = result.notes.filter((n) => n.id !== 'm1' && n.id !== 'm2');
    expect(chordNotes.length).toBeGreaterThan(0);
    expect(result.label).toBe('Generate chords');
  });

  it('voices each beat segment within the requested voiceCount and octave range', () => {
    const melody = [makeNote({ id: 'm1', startBeat: 0, durationBeats: 2, midiNote: 60 })];
    const ctx = makeCommandContext(melody, new Set(['m1']));
    const result = runCommand(generateChords, ctx, {
      octaveRange: { min: 3, max: 5 },
      voiceCount: 3,
      voicingStrategy: 'smooth-voice-leading',
      source: 'selection-derived',
    });
    const chordNotes = result.notes.filter((n) => n.id !== 'm1');
    expect(chordNotes).toHaveLength(3);
    for (const n of chordNotes) {
      expect(n.startBeat).toBe(0);
      expect(n.durationBeats).toBe(2);
      expect(n.midiNote).toBeGreaterThanOrEqual(12 * (3 + 1));
      expect(n.midiNote).toBeLessThanOrEqual(12 * (5 + 2) - 1);
    }
  });

  it('is applicable with a non-empty chord track even when nothing is selected', () => {
    const ctx = makeCommandContext([], new Set(), {
      chordTrack: [{ id: 'c1', beat: 0, root: 0, quality: 'maj7' }],
    });
    expect(generateChords.isApplicable(ctx)).toBe(true);
  });

  it('is not applicable when both the selection and the chord track are empty', () => {
    const ctx = makeCommandContext([], new Set(), { chordTrack: [] });
    expect(generateChords.isApplicable(ctx)).toBe(false);
  });

  it("source: 'chord-track' voices the chord track's events within targetRange, with no melody selected", () => {
    const ctx = makeCommandContext([], new Set(), {
      chordTrack: [{ id: 'c1', beat: 0, root: 0, quality: 'maj7' }], // Cmaj7: C E G B
    });
    const result = runCommand(generateChords, ctx, {
      octaveRange: { min: 3, max: 5 },
      voiceCount: 4,
      voicingStrategy: 'smooth-voice-leading',
      source: 'chord-track',
      targetRange: { min: 0, max: 4 },
    });
    expect(result.notes).toHaveLength(4);
    for (const n of result.notes) {
      expect(n.startBeat).toBe(0);
      expect(n.durationBeats).toBe(4);
      expect([0, 4, 7, 11]).toContain(n.midiNote % 12);
    }
    expect(result.label).toBe('Generate chords');
  });

  it("source: 'chord-track' produces one voiced segment per chord event within targetRange", () => {
    const ctx = makeCommandContext([], new Set(), {
      chordTrack: [
        { id: 'c1', beat: 0, root: 0, quality: 'maj' }, // C major, 0..4
        { id: 'c2', beat: 4, root: 7, quality: '7' }, // G7, 4..8
      ],
    });
    const result = runCommand(generateChords, ctx, {
      octaveRange: { min: 3, max: 5 },
      voiceCount: 3,
      voicingStrategy: 'smooth-voice-leading',
      source: 'chord-track',
      targetRange: { min: 0, max: 8 },
    });
    const atZero = result.notes.filter((n) => n.startBeat === 0);
    const atFour = result.notes.filter((n) => n.startBeat === 4);
    expect(atZero).toHaveLength(3);
    expect(atFour).toHaveLength(3);
  });

  it("source: 'chord-track' falls back to a range starting at ctx.playhead when targetRange is omitted", () => {
    const ctx = makeCommandContext([], new Set(), {
      playhead: 8,
      chordTrack: [{ id: 'c1', beat: 8, root: 0, quality: 'maj' }],
    });
    const result = runCommand(generateChords, ctx, {
      octaveRange: { min: 3, max: 5 },
      voiceCount: 3,
      voicingStrategy: 'smooth-voice-leading',
      source: 'chord-track',
    });
    expect(result.notes).toHaveLength(3);
    expect(result.notes[0].startBeat).toBe(8);
  });

  it("source: 'chord-track' produces no chord notes when the chord track has no events in range", () => {
    const melody = [makeNote({ id: 'm1', startBeat: 0, durationBeats: 1, midiNote: 60 })];
    const ctx = makeCommandContext(melody, new Set(['m1']), { chordTrack: [] });
    const result = runCommand(generateChords, ctx, {
      octaveRange: { min: 3, max: 5 },
      voiceCount: 3,
      voicingStrategy: 'smooth-voice-leading',
      source: 'chord-track',
      targetRange: { min: 0, max: 4 },
    });
    expect(result.notes).toEqual(melody);
  });
});
