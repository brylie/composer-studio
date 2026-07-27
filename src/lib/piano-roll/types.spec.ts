import { describe, expect, it } from 'vitest';
import { clampNote, MAX_MIDI, MIN_DURATION_BEATS, MIN_MIDI } from './types.js';

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

  it('clamps a finite out-of-range midiNote below the minimum to MIN_MIDI', () => {
    const note = clampNote(makeNote({ midiNote: MIN_MIDI - 10 }));
    expect(note.midiNote).toBe(MIN_MIDI);
  });

  it('clamps a finite out-of-range midiNote above the maximum to MAX_MIDI', () => {
    const note = clampNote(makeNote({ midiNote: MAX_MIDI + 10 }));
    expect(note.midiNote).toBe(MAX_MIDI);
  });

  it('replaces a NaN startBeat with 0', () => {
    const note = clampNote(makeNote({ startBeat: NaN }));
    expect(note.startBeat).toBe(0);
  });

  it('clamps a -Infinity startBeat to 0', () => {
    const note = clampNote(makeNote({ startBeat: -Infinity }));
    expect(note.startBeat).toBe(0);
  });

  it('resolves a +Infinity startBeat to exactly 0 instead of propagating Infinity', () => {
    const note = clampNote(makeNote({ startBeat: Infinity }));
    expect(note.startBeat).toBe(0);
  });

  it('clamps a finite negative startBeat to 0', () => {
    const note = clampNote(makeNote({ startBeat: -5 }));
    expect(note.startBeat).toBe(0);
  });

  it('replaces a NaN durationBeats with the minimum duration', () => {
    const note = clampNote(makeNote({ durationBeats: NaN }));
    expect(note.durationBeats).toBe(MIN_DURATION_BEATS);
  });

  it('resolves a +Infinity durationBeats to exactly MIN_DURATION_BEATS instead of propagating Infinity', () => {
    const note = clampNote(makeNote({ durationBeats: Infinity }));
    expect(note.durationBeats).toBe(MIN_DURATION_BEATS);
  });

  it('clamps a finite durationBeats below the minimum to MIN_DURATION_BEATS', () => {
    const note = clampNote(makeNote({ durationBeats: MIN_DURATION_BEATS / 2 }));
    expect(note.durationBeats).toBe(MIN_DURATION_BEATS);
  });

  it('replaces a NaN velocity with the minimum velocity', () => {
    const note = clampNote(makeNote({ velocity: NaN }));
    expect(note.velocity).toBe(1);
  });

  it('clamps a +Infinity velocity to the minimum bound instead of propagating Infinity', () => {
    const note = clampNote(makeNote({ velocity: Infinity }));
    expect(note.velocity).toBe(1);
  });

  it('clamps a finite out-of-range velocity below the minimum to 1', () => {
    const note = clampNote(makeNote({ velocity: 0 }));
    expect(note.velocity).toBe(1);
  });

  it('clamps a finite out-of-range velocity above the maximum to 127', () => {
    const note = clampNote(makeNote({ velocity: 200 }));
    expect(note.velocity).toBe(127);
  });
});
