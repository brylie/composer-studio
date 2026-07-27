import { describe, expect, it } from 'vitest';
import { MAX_MIDI, MIN_MIDI } from '../types.js';
import { makeCommandContext, makeNote, runCommand } from './test-helpers.js';
import { transpose } from './transpose.js';

describe('transpose', () => {
  it('is not applicable with an empty selection', () => {
    const ctx = makeCommandContext([], new Set());
    expect(transpose.isApplicable(ctx)).toBe(false);
  });

  it('is applicable with at least one selected note', () => {
    const notes = [makeNote({ id: '1' })];
    const ctx = makeCommandContext(notes, new Set(['1']));
    expect(transpose.isApplicable(ctx)).toBe(true);
  });

  it('exposes a disabled-reason key for the empty-selection case', () => {
    expect(transpose.getDisabledReasonKey?.(makeCommandContext([], new Set()))).toBe(
      'commands.disabled.selectAtLeastOne',
    );
  });

  it('shifts selected notes by the given semitones and leaves others untouched', () => {
    const notes = [makeNote({ id: '1', midiNote: 60 }), makeNote({ id: '2', midiNote: 64 })];
    const ctx = makeCommandContext(notes, new Set(['1']));
    const result = runCommand(transpose, ctx, { semitones: 5 });
    const n1 = result.notes.find((n) => n.id === '1');
    const n2 = result.notes.find((n) => n.id === '2');
    expect(n1?.midiNote).toBe(65);
    expect(n2?.midiNote).toBe(64); // unselected note untouched
    expect(result.notes).toHaveLength(2);
  });

  it('clamps transposed pitch to [MIN_MIDI, MAX_MIDI]', () => {
    const notes = [makeNote({ id: '1', midiNote: MAX_MIDI - 1 })];
    const ctx = makeCommandContext(notes, new Set(['1']));
    const result = runCommand(transpose, ctx, { semitones: 24 });
    expect(result.notes[0].midiNote).toBe(MAX_MIDI);

    const low = [makeNote({ id: '2', midiNote: MIN_MIDI + 1 })];
    const lowCtx = makeCommandContext(low, new Set(['2']));
    const lowResult = runCommand(transpose, lowCtx, { semitones: -24 });
    expect(lowResult.notes[0].midiNote).toBe(MIN_MIDI);
  });
});
