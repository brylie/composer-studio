import type { CommandContext } from '../types.js';
import type { RatioParams } from './augmentation.js';
import { scaleTiming } from './augmentation.js';
import type { CommandDescriptor } from './types.js';

/** Compresses selected notes' durations and spacing by a ratio (e.g. 0.5 = half). */
export const diminution: CommandDescriptor<RatioParams> = {
  id: 'diminution',
  category: 'transform',
  labelKey: 'commands.diminution.label',
  icon: 'compress-horizontal',
  params: [
    { key: 'ratio', label: 'Ratio', type: 'number', min: 0.125, max: 1, step: 0.125, default: 0.5 },
  ],
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
      label: `Diminution x${String(params.ratio)}`,
    };
  },
};
