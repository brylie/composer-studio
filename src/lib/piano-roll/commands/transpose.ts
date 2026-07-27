import type { CommandContext } from '../types.js';
import { clampNote } from '../types.js';
import type { CommandDescriptor } from './types.js';

export interface TransposeParams extends Record<string, unknown> {
  semitones: number;
}

/** Shifts every selected note's pitch by a fixed number of semitones. */
export const transpose: CommandDescriptor<TransposeParams> = {
  id: 'transpose',
  category: 'transform',
  labelKey: 'commands.transpose.label',
  icon: 'arrow-up-down',
  params: [
    {
      key: 'semitones',
      label: 'Semitones',
      type: 'number',
      min: -24,
      max: 24,
      step: 1,
      default: 1,
    },
  ],
  isApplicable(ctx: CommandContext) {
    return ctx.count >= 1;
  },
  getDisabledReasonKey() {
    return 'commands.disabled.selectAtLeastOne';
  },
  run(ctx: CommandContext, params: TransposeParams) {
    const selectedIds = new Set(ctx.notes.map((n) => n.id));
    const transposed = ctx.notes.map((n) =>
      clampNote({ ...n, midiNote: n.midiNote + params.semitones }),
    );
    return {
      notes: [...ctx.allNotes.filter((n) => !selectedIds.has(n.id)), ...transposed],
      label: `Transpose ${params.semitones >= 0 ? '+' : ''}${String(params.semitones)}`,
    };
  },
};
