import { describe, expect, it } from 'vitest';
import { invert } from './invert.js';
import { findNoteById, makeCommandContext, makeNote, runCommand } from './test-helpers.js';

describe('invert', () => {
  it('is not applicable with an empty selection', () => {
    const ctx = makeCommandContext([], new Set());
    expect(invert.isApplicable(ctx)).toBe(false);
  });

  it('exposes a disabled-reason key for the empty-selection case', () => {
    expect(invert.getDisabledReasonKey?.(makeCommandContext([], new Set()))).toBe(
      'commands.disabled.selectAtLeastOne',
    );
  });

  it('defaults to pivot 60 for first-note/selection-center when nothing is selected', () => {
    const ctx = makeCommandContext([], new Set());
    const firstNoteResult = runCommand(invert, ctx, { pivot: 'first-note', customPivot: 0 });
    expect(firstNoteResult.notes).toEqual([]);
    const centerResult = runCommand(invert, ctx, { pivot: 'selection-center', customPivot: 0 });
    expect(centerResult.notes).toEqual([]);
  });

  it('inverts around the selection center by default', () => {
    const notes = [makeNote({ id: '1', midiNote: 60 }), makeNote({ id: '2', midiNote: 64 })];
    const ctx = makeCommandContext(notes, new Set(['1', '2']));
    // pitchRange = { min: 60, max: 64 }, center = 62
    const result = runCommand(invert, ctx, { pivot: 'selection-center', customPivot: 60 });
    const n1 = findNoteById(result.notes, '1');
    const n2 = findNoteById(result.notes, '2');
    expect(n1.midiNote).toBe(64); // 2*62 - 60
    expect(n2.midiNote).toBe(60); // 2*62 - 64
  });

  it('inverts around a custom pivot', () => {
    const notes = [makeNote({ id: '1', midiNote: 60 })];
    const ctx = makeCommandContext(notes, new Set(['1']));
    const result = runCommand(invert, ctx, { pivot: 'custom', customPivot: 60 });
    expect(result.notes[0].midiNote).toBe(60); // pivot on itself is a no-op
  });

  it('inverts around the first note when pivot is first-note', () => {
    const notes = [makeNote({ id: '1', midiNote: 60 }), makeNote({ id: '2', midiNote: 65 })];
    const ctx = makeCommandContext(notes, new Set(['1', '2']));
    const result = runCommand(invert, ctx, { pivot: 'first-note', customPivot: 0 });
    const n1 = findNoteById(result.notes, '1');
    const n2 = findNoteById(result.notes, '2');
    expect(n1.midiNote).toBe(60); // pivot is the first note itself
    expect(n2.midiNote).toBe(55); // 2*60 - 65
  });

  it("customPivot param's showIf is only true when pivot is 'custom'", () => {
    const customPivotField = invert.params?.find((p) => p.key === 'customPivot');
    expect(customPivotField?.showIf?.({ pivot: 'custom' })).toBe(true);
    expect(customPivotField?.showIf?.({ pivot: 'selection-center' })).toBe(false);
  });
});
