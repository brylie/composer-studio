import { describe, expect, it } from 'vitest';
import { augmentation } from './augmentation.js';
import { diminution } from './diminution.js';
import { findNoteById, makeCommandContext, makeNote, runCommand } from './test-helpers.js';

describe('augmentation', () => {
  it('is not applicable with an empty selection and exposes a disabled-reason key', () => {
    const ctx = makeCommandContext([], new Set());
    expect(augmentation.isApplicable(ctx)).toBe(false);
    expect(augmentation.getDisabledReasonKey?.(ctx)).toBe('commands.disabled.selectAtLeastOne');
  });

  it('run() with an empty selection is a no-op (anchor defaults to 0)', () => {
    const ctx = makeCommandContext([], new Set());
    const result = runCommand(augmentation, ctx, { ratio: 2 });
    expect(result.notes).toEqual([]);
  });

  it('doubles durations and spacing relative to the selection start', () => {
    const notes = [
      makeNote({ id: '1', startBeat: 0, durationBeats: 1 }),
      makeNote({ id: '2', startBeat: 2, durationBeats: 1 }),
    ];
    const ctx = makeCommandContext(notes, new Set(['1', '2']));
    const result = runCommand(augmentation, ctx, { ratio: 2 });
    const n1 = findNoteById(result.notes, '1');
    const n2 = findNoteById(result.notes, '2');
    expect(n1.startBeat).toBe(0);
    expect(n1.durationBeats).toBe(2);
    expect(n2.startBeat).toBe(4);
    expect(n2.durationBeats).toBe(2);
  });
});

describe('diminution', () => {
  it('is not applicable with an empty selection and exposes a disabled-reason key', () => {
    const ctx = makeCommandContext([], new Set());
    expect(diminution.isApplicable(ctx)).toBe(false);
    expect(diminution.getDisabledReasonKey?.(ctx)).toBe('commands.disabled.selectAtLeastOne');
  });

  it('halves durations and spacing relative to the selection start', () => {
    const notes = [
      makeNote({ id: '1', startBeat: 0, durationBeats: 2 }),
      makeNote({ id: '2', startBeat: 4, durationBeats: 2 }),
    ];
    const ctx = makeCommandContext(notes, new Set(['1', '2']));
    const result = runCommand(diminution, ctx, { ratio: 0.5 });
    const n1 = findNoteById(result.notes, '1');
    const n2 = findNoteById(result.notes, '2');
    expect(n1.startBeat).toBe(0);
    expect(n1.durationBeats).toBe(1);
    expect(n2.startBeat).toBe(2);
    expect(n2.durationBeats).toBe(1);
  });
});
