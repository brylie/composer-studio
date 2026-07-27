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

  it("produces no chord notes for source: 'chord-track' (Phase 7 stub)", () => {
    const melody = [makeNote({ id: 'm1', startBeat: 0, durationBeats: 1, midiNote: 60 })];
    const ctx = makeCommandContext(melody, new Set(['m1']));
    const result = runCommand(generateChords, ctx, {
      octaveRange: { min: 3, max: 5 },
      voiceCount: 3,
      voicingStrategy: 'smooth-voice-leading',
      source: 'chord-track',
    });
    expect(result.notes).toEqual(melody);
  });
});
