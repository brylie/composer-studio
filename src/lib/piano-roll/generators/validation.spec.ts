import { describe, expect, it } from 'vitest';
import { makeBounds, makeNoteDraft, makeNotePlan } from './test-helpers.js';
import { MAX_GENERATED_NOTES, validateGeneratedResult } from './validation.js';

function validate(notes: ReturnType<typeof makeNoteDraft>[], bounds = makeBounds()) {
  const output = makeNotePlan(bounds, notes);
  return validateGeneratedResult({ output, notes, diagnostics: [] }, bounds);
}

describe('validateGeneratedResult', () => {
  it('returns no diagnostics for a well-formed, in-bounds, sorted result', () => {
    const notes = [
      makeNoteDraft({ eventKey: 'a', midiNote: 60, startBeat: 0, durationBeats: 1 }),
      makeNoteDraft({ eventKey: 'b', midiNote: 64, startBeat: 1, durationBeats: 1 }),
    ];
    expect(validate(notes)).toEqual([]);
  });

  it('flags a non-finite value', () => {
    const notes = [makeNoteDraft({ eventKey: 'a', midiNote: Number.NaN })];
    expect(validate(notes).map((d) => d.code)).toContain('non-finite-value');
  });

  it('flags a pitch outside the generator pitch bounds', () => {
    const bounds = makeBounds({ pitch: { minMidi: 60, maxMidi: 72 } });
    const notes = [makeNoteDraft({ eventKey: 'a', midiNote: 40 })];
    expect(validate(notes, bounds).map((d) => d.code)).toContain('midi-out-of-bounds');
  });

  it('flags a pitch outside the global MIN_MIDI/MAX_MIDI range even when within generator bounds', () => {
    const bounds = makeBounds({ pitch: { minMidi: 0, maxMidi: 127 } });
    const notes = [makeNoteDraft({ eventKey: 'a', midiNote: 200 })];
    expect(validate(notes, bounds).map((d) => d.code)).toContain('midi-out-of-bounds');
  });

  it('flags a start outside the time bounds', () => {
    const bounds = makeBounds({ time: { startBeat: 0, endBeat: 4 } });
    const notes = [makeNoteDraft({ eventKey: 'a', startBeat: 5 })];
    expect(validate(notes, bounds).map((d) => d.code)).toContain('start-out-of-bounds');
  });

  it('flags a duration below the minimum', () => {
    const notes = [makeNoteDraft({ eventKey: 'a', durationBeats: 0 })];
    expect(validate(notes).map((d) => d.code)).toContain('duration-too-short');
  });

  it('flags a note that ends past the time bounds when allowTail is false', () => {
    const bounds = makeBounds({ time: { startBeat: 0, endBeat: 4 }, allowTail: false });
    const notes = [makeNoteDraft({ eventKey: 'a', startBeat: 3, durationBeats: 2 })];
    expect(validate(notes, bounds).map((d) => d.code)).toContain('note-exceeds-tail');
  });

  it('allows a tail past the time bounds when allowTail is true', () => {
    const bounds = makeBounds({ time: { startBeat: 0, endBeat: 4 }, allowTail: true });
    const notes = [makeNoteDraft({ eventKey: 'a', startBeat: 3, durationBeats: 2 })];
    expect(validate(notes, bounds).map((d) => d.code)).not.toContain('note-exceeds-tail');
  });

  it('still requires the start to lie inside the time bounds even when allowTail is true', () => {
    const bounds = makeBounds({ time: { startBeat: 0, endBeat: 4 }, allowTail: true });
    const notes = [makeNoteDraft({ eventKey: 'a', startBeat: 10, durationBeats: 1 })];
    expect(validate(notes, bounds).map((d) => d.code)).toContain('start-out-of-bounds');
  });

  it('flags a velocity outside [1, 127]', () => {
    expect(validate([makeNoteDraft({ eventKey: 'a', velocity: 0 })]).map((d) => d.code)).toContain(
      'velocity-out-of-range',
    );
    expect(
      validate([makeNoteDraft({ eventKey: 'b', velocity: 200 })]).map((d) => d.code),
    ).toContain('velocity-out-of-range');
  });

  it('warns on duplicate notes with identical pitch, start, and duration', () => {
    const notes = [
      makeNoteDraft({ eventKey: 'a', midiNote: 60, startBeat: 0, durationBeats: 1 }),
      makeNoteDraft({ eventKey: 'b', midiNote: 60, startBeat: 0, durationBeats: 1 }),
    ];
    const diagnostics = validate(notes);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ level: 'warning', code: 'duplicate-note' }),
    );
  });

  it('warns when output is not sorted by start beat then pitch', () => {
    const notes = [
      makeNoteDraft({ eventKey: 'a', midiNote: 60, startBeat: 1 }),
      makeNoteDraft({ eventKey: 'b', midiNote: 60, startBeat: 0 }),
    ];
    expect(validate(notes).map((d) => d.code)).toContain('unsorted-output');
  });

  it('flags exceeding the shared preview note-count limit', () => {
    const notes = Array.from({ length: MAX_GENERATED_NOTES + 1 }, (_, i) =>
      makeNoteDraft({ eventKey: `n${String(i)}`, midiNote: 60, startBeat: 0 }),
    );
    expect(validate(notes).map((d) => d.code)).toContain('max-notes-exceeded');
  });

  it('does not flag exactly the limit', () => {
    const notes = Array.from({ length: MAX_GENERATED_NOTES }, (_, i) =>
      makeNoteDraft({ eventKey: `n${String(i)}`, midiNote: 60, startBeat: 0 }),
    );
    expect(validate(notes).map((d) => d.code)).not.toContain('max-notes-exceeded');
  });
});
