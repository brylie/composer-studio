import type { CommandContext, Note } from '../types.js';
import { clampNote } from '../types.js';
import type { CommandDescriptor } from './types.js';

export interface RatioParams extends Record<string, unknown> {
  ratio: number;
}

/**
 * Scales note timing by `ratio`: each note's offset from the selection's
 * own start beat, and its duration, are both multiplied by `ratio` — used
 * by both `augmentation` (ratio > 1) and `diminution` (ratio < 1).
 */
export function scaleTiming(ctx: CommandContext, ratio: number): Note[] {
  const anchor = ctx.beatRange?.start ?? 0;
  return ctx.notes.map((n) =>
    clampNote({
      ...n,
      startBeat: anchor + (n.startBeat - anchor) * ratio,
      durationBeats: n.durationBeats * ratio,
    }),
  );
}

/** Stretches selected notes' durations and spacing by a ratio (e.g. 2 = double). */
export const augmentation: CommandDescriptor<RatioParams> = {
  id: 'augmentation',
  category: 'transform',
  labelKey: 'commands.augmentation.label',
  icon: 'expand-horizontal',
  params: [{ key: 'ratio', label: 'Ratio', type: 'number', min: 1, max: 8, step: 0.5, default: 2 }],
  isApplicable(ctx: CommandContext) {
    return ctx.count >= 1;
  },
  getDisabledReasonKey() {
    return 'commands.disabled.selectAtLeastOne';
  },
  run(ctx: CommandContext, params: RatioParams) {
    const selectedIds = new Set(ctx.notes.map((n) => n.id));
    const scaled = scaleTiming(ctx, params.ratio);
    return {
      notes: [...ctx.allNotes.filter((n) => !selectedIds.has(n.id)), ...scaled],
      label: `Augmentation x${String(params.ratio)}`,
    };
  },
};
