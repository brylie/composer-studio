import type { CommandContext } from '../types.js';
import { clampNote } from '../types.js';
import type { CommandDescriptor } from './types.js';

export interface InvertParams extends Record<string, unknown> {
  pivot: 'first-note' | 'selection-center' | 'custom';
  customPivot: number;
}

function resolvePivot(ctx: CommandContext, params: InvertParams): number {
  switch (params.pivot) {
    case 'first-note':
      return ctx.notes[0]?.midiNote ?? 60;
    case 'custom':
      return params.customPivot;
    case 'selection-center':
    default:
      return ctx.pitchRange ? (ctx.pitchRange.min + ctx.pitchRange.max) / 2 : 60;
  }
}

/** Mirrors selected notes' pitches around a pivot (2 * pivot - midiNote). */
export const invert: CommandDescriptor<InvertParams> = {
  id: 'invert',
  category: 'transform',
  labelKey: 'commands.invert.label',
  icon: 'flip-vertical',
  params: [
    {
      key: 'pivot',
      label: 'Pivot',
      type: 'select',
      default: 'selection-center',
      options: [
        { value: 'first-note', label: 'First note' },
        { value: 'selection-center', label: 'Selection center' },
        { value: 'custom', label: 'Custom' },
      ],
    },
    {
      key: 'customPivot',
      label: 'Custom pivot (MIDI note)',
      type: 'number',
      min: 0,
      max: 127,
      step: 1,
      default: 60,
      showIf: (values) => values.pivot === 'custom',
    },
  ],
  isApplicable(ctx: CommandContext) {
    return ctx.count >= 1;
  },
  getDisabledReasonKey() {
    return 'commands.disabled.selectAtLeastOne';
  },
  run(ctx: CommandContext, params: InvertParams) {
    const pivot = resolvePivot(ctx, params);
    const selectedIds = new Set(ctx.notes.map((n) => n.id));
    const inverted = ctx.notes.map((n) => clampNote({ ...n, midiNote: 2 * pivot - n.midiNote }));
    return {
      notes: [...ctx.allNotes.filter((n) => !selectedIds.has(n.id)), ...inverted],
      label: 'Invert',
    };
  },
};
