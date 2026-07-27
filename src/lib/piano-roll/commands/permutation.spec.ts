import { describe, expect, it } from 'vitest';
import { permutation } from './permutation.js';
import { makeCommandContext, makeNote, runCommand } from './test-helpers.js';

describe('permutation', () => {
  it('is not applicable with fewer than 2 selected notes', () => {
    const ctx = makeCommandContext([makeNote({ id: '1' })], new Set(['1']));
    expect(permutation.isApplicable(ctx)).toBe(false);
  });

  it('exposes a disabled-reason key for the under-two-notes case', () => {
    const ctx = makeCommandContext([makeNote({ id: '1' })], new Set(['1']));
    expect(permutation.getDisabledReasonKey?.(ctx)).toBe('commands.disabled.selectAtLeastTwo');
  });

  it('is applicable with 2 or more selected notes', () => {
    const notes = [makeNote({ id: '1' }), makeNote({ id: '2' })];
    const ctx = makeCommandContext(notes, new Set(['1', '2']));
    expect(permutation.isApplicable(ctx)).toBe(true);
  });

  it('is deterministic for a given seed', () => {
    const notes = [
      makeNote({ id: '1', startBeat: 0, midiNote: 60 }),
      makeNote({ id: '2', startBeat: 1, midiNote: 62 }),
      makeNote({ id: '3', startBeat: 2, midiNote: 64 }),
    ];
    const ctx = makeCommandContext(notes, new Set(['1', '2', '3']));
    const a = runCommand(permutation, ctx, { seed: 42 });
    const b = runCommand(permutation, ctx, { seed: 42 });
    expect(a.notes.map((n) => n.midiNote)).toEqual(b.notes.map((n) => n.midiNote));
  });

  it('preserves the multiset of time slots and pitches, only reassigning pitches to slots', () => {
    const notes = [
      makeNote({ id: '1', startBeat: 0, midiNote: 60 }),
      makeNote({ id: '2', startBeat: 1, midiNote: 62 }),
      makeNote({ id: '3', startBeat: 2, midiNote: 64 }),
    ];
    const ctx = makeCommandContext(notes, new Set(['1', '2', '3']));
    const result = runCommand(permutation, ctx, { seed: 7 });
    expect(result.notes).toHaveLength(3);
    expect(result.notes.map((n) => n.startBeat).sort()).toEqual([0, 1, 2]);
    expect(result.notes.map((n) => n.midiNote).sort()).toEqual([60, 62, 64]);
  });
});
