import { describe, expect, it } from 'vitest';
import { clampNote, MIN_DURATION_BEATS, MIN_MIDI } from './types.js';

function makeNote(overrides: Partial<Parameters<typeof clampNote>[0]> = {}) {
  return {
    id: 'n1',
    midiNote: 60,
    startBeat: 0,
    durationBeats: 1,
    velocity: 80,
    ...overrides,
  };
}

describe('clampNote', () => {
  it('clamps in-range values unchanged (aside from rounding)', () => {
    const note = clampNote(makeNote());
    expect(note).toEqual(makeNote());
  });

  it('replaces a NaN midiNote with the minimum bound instead of propagating NaN', () => {
    const note = clampNote(makeNote({ midiNote: NaN }));
    expect(note.midiNote).toBe(MIN_MIDI);
  });

  it('clamps a +Infinity midiNote to the minimum bound instead of propagating Infinity', () => {
    const note = clampNote(makeNote({ midiNote: Infinity }));
    expect(note.midiNote).toBe(MIN_MIDI);
  });

  it('clamps a -Infinity midiNote to the minimum bound', () => {
    const note = clampNote(makeNote({ midiNote: -Infinity }));
    expect(note.midiNote).toBe(MIN_MIDI);
  });

  it('replaces a NaN startBeat with 0', () => {
    const note = clampNote(makeNote({ startBeat: NaN }));
    expect(note.startBeat).toBe(0);
  });

  it('clamps a -Infinity startBeat to 0', () => {
    const note = clampNote(makeNote({ startBeat: -Infinity }));
    expect(note.startBeat).toBe(0);
  });

  it('does not let a +Infinity startBeat survive as non-finite', () => {
    const note = clampNote(makeNote({ startBeat: Infinity }));
    expect(Number.isFinite(note.startBeat)).toBe(true);
  });

  it('replaces a NaN durationBeats with the minimum duration', () => {
    const note = clampNote(makeNote({ durationBeats: NaN }));
    expect(note.durationBeats).toBe(MIN_DURATION_BEATS);
  });

  it('does not let an Infinity durationBeats survive as non-finite', () => {
    const note = clampNote(makeNote({ durationBeats: Infinity }));
    expect(Number.isFinite(note.durationBeats)).toBe(true);
  });

  it('replaces a NaN velocity with the minimum velocity', () => {
    const note = clampNote(makeNote({ velocity: NaN }));
    expect(note.velocity).toBe(1);
  });

  it('clamps a +Infinity velocity to the minimum bound instead of propagating Infinity', () => {
    const note = clampNote(makeNote({ velocity: Infinity }));
    expect(note.velocity).toBe(1);
  });
});
