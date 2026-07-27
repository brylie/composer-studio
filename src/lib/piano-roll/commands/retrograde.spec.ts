import { describe, expect, it } from 'vitest';
import { retrograde } from './retrograde.js';
import { findNoteById, makeCommandContext, makeNote, runCommand } from './test-helpers.js';

describe('retrograde', () => {
  it('is not applicable with an empty selection', () => {
    const ctx = makeCommandContext([], new Set());
    expect(retrograde.isApplicable(ctx)).toBe(false);
  });

  it('exposes a disabled-reason key for the empty-selection case', () => {
    expect(retrograde.getDisabledReasonKey?.(makeCommandContext([], new Set()))).toBe(
      'commands.disabled.selectAtLeastOne',
    );
  });

  it('is not applicable when count >= 1 but beatRange is null (defensive branch)', () => {
    const ctx = { ...makeCommandContext([], new Set()), count: 1, beatRange: null };
    expect(retrograde.isApplicable(ctx)).toBe(false);
  });

  it('run() is a no-op passthrough when there is no beatRange (defensive branch)', () => {
    const ctx = makeCommandContext([], new Set());
    const result = runCommand(retrograde, ctx, {});
    expect(result.notes).toEqual(ctx.allNotes);
    expect(result.label).toBe('Retrograde');
  });

  it('reverses note order across the selection span, preserving durations', () => {
    const notes = [
      makeNote({ id: '1', startBeat: 0, durationBeats: 1 }),
      makeNote({ id: '2', startBeat: 1, durationBeats: 2 }),
      makeNote({ id: '3', startBeat: 3, durationBeats: 1 }),
    ];
    const ctx = makeCommandContext(notes, new Set(['1', '2', '3']));
    const result = runCommand(retrograde, ctx, {});

    const byId = (id: string) => findNoteById(result.notes, id);
    // span is [0, 4); note 1 (0..1) -> was first, becomes last (ends at 4)
    expect(byId('1').startBeat).toBe(3);
    expect(byId('1').durationBeats).toBe(1);
    // note 3 (3..4) -> was last, becomes first
    expect(byId('3').startBeat).toBe(0);
    expect(byId('3').durationBeats).toBe(1);
    // note 2 (1..3), middle, stays centered
    expect(byId('2').startBeat).toBe(1);
    expect(byId('2').durationBeats).toBe(2);
  });
});
