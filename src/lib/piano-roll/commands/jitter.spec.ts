import { describe, expect, it } from 'vitest';
import { jitter } from './jitter.js';
import { findNoteById, makeCommandContext, makeNote, runCommand } from './test-helpers.js';

describe('jitter', () => {
  it('is not applicable with an empty selection and exposes a disabled-reason key', () => {
    const ctx = makeCommandContext([], new Set());
    expect(jitter.isApplicable(ctx)).toBe(false);
    expect(jitter.getDisabledReasonKey?.(ctx)).toBe('commands.disabled.selectAtLeastOne');
  });

  it('is deterministic for a given seed', () => {
    const notes = [makeNote({ id: '1', startBeat: 2, midiNote: 60, velocity: 100 })];
    const ctx = makeCommandContext(notes, new Set(['1']));
    const params = { timeAmount: 0.5, pitchAmount: 3, velocityAmount: 20, seed: 123 };
    const a = runCommand(jitter, ctx, params);
    const b = runCommand(jitter, ctx, params);
    expect(a.notes).toEqual(b.notes);
  });

  it('keeps perturbations within the requested amounts', () => {
    const notes = [makeNote({ id: '1', startBeat: 2, midiNote: 60, velocity: 100 })];
    const ctx = makeCommandContext(notes, new Set(['1']));
    const result = runCommand(jitter, ctx, {
      timeAmount: 0.5,
      pitchAmount: 3,
      velocityAmount: 20,
      seed: 1,
    });
    const n = result.notes[0];
    expect(n.startBeat).toBeGreaterThanOrEqual(2 - 0.5);
    expect(n.startBeat).toBeLessThanOrEqual(2 + 0.5);
    expect(n.midiNote).toBeGreaterThanOrEqual(57);
    expect(n.midiNote).toBeLessThanOrEqual(63);
    expect(n.velocity).toBeGreaterThanOrEqual(80);
    expect(n.velocity).toBeLessThanOrEqual(120);
  });

  it('leaves unselected notes untouched', () => {
    const notes = [
      makeNote({ id: '1', startBeat: 0 }),
      makeNote({ id: '2', startBeat: 5, midiNote: 70 }),
    ];
    const ctx = makeCommandContext(notes, new Set(['1']));
    const result = runCommand(jitter, ctx, {
      timeAmount: 1,
      pitchAmount: 5,
      velocityAmount: 30,
      seed: 9,
    });
    const n2 = findNoteById(result.notes, '2');
    expect(n2).toEqual(notes[1]);
  });
});
