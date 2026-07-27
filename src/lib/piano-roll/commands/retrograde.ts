import type { CommandContext } from '../types.js';
import { clampNote } from '../types.js';
import type { CommandDescriptor } from './types.js';

/**
 * Reverses selected notes in time: the note that started first ends last
 * and vice versa, mirrored across the selection's own beat range, with
 * each note's own duration preserved.
 */
export const retrograde: CommandDescriptor = {
  id: 'retrograde',
  category: 'transform',
  labelKey: 'commands.retrograde.label',
  icon: 'reverse',
  isApplicable(ctx: CommandContext) {
    return ctx.count >= 1 && ctx.beatRange !== null;
  },
  getDisabledReasonKey() {
    return 'commands.disabled.selectAtLeastOne';
  },
  run(ctx: CommandContext) {
    const beatRange = ctx.beatRange;
    if (!beatRange) return { notes: ctx.allNotes, label: 'Retrograde' };
    const { start, end } = beatRange;
    const selectedIds = new Set(ctx.notes.map((n) => n.id));
    const reversed = ctx.notes.map((n) =>
      clampNote({ ...n, startBeat: start + end - (n.startBeat + n.durationBeats) }),
    );
    return {
      notes: [...ctx.allNotes.filter((n) => !selectedIds.has(n.id)), ...reversed],
      label: 'Retrograde',
    };
  },
};
