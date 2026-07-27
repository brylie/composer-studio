import { createSeededRandom } from '../random.js';
import type { CommandContext } from '../types.js';
import { clampNote } from '../types.js';
import type { CommandDescriptor } from './types.js';

export interface JitterParams extends Record<string, unknown> {
  timeAmount: number;
  pitchAmount: number;
  velocityAmount: number;
  seed: number;
}

/**
 * Applies small seeded random perturbations to selected notes' timing,
 * pitch, and velocity. Deliberately produces sub-snap positions
 * (editing-model.md) — this is the one command that's supposed to.
 */
export const jitter: CommandDescriptor<JitterParams> = {
  id: 'jitter',
  category: 'transform',
  labelKey: 'commands.jitter.label',
  icon: 'dice',
  params: [
    {
      key: 'timeAmount',
      label: 'Time amount',
      type: 'range',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.1,
    },
    {
      key: 'pitchAmount',
      label: 'Pitch amount',
      type: 'range',
      min: 0,
      max: 12,
      step: 1,
      default: 1,
    },
    {
      key: 'velocityAmount',
      label: 'Velocity amount',
      type: 'range',
      min: 0,
      max: 40,
      step: 1,
      default: 10,
    },
    { key: 'seed', label: 'Seed', type: 'number', min: 0, max: 999999, step: 1, default: 1 },
  ],
  isApplicable(ctx: CommandContext) {
    return ctx.count >= 1;
  },
  getDisabledReasonKey() {
    return 'commands.disabled.selectAtLeastOne';
  },
  run(ctx: CommandContext, params: JitterParams) {
    const random = createSeededRandom(params.seed);
    const selectedIds = new Set(ctx.notes.map((n) => n.id));
    const jittered = ctx.notes.map((n) =>
      clampNote({
        ...n,
        startBeat: n.startBeat + (random() * 2 - 1) * params.timeAmount,
        midiNote: Math.round(n.midiNote + (random() * 2 - 1) * params.pitchAmount),
        velocity: Math.round(n.velocity + (random() * 2 - 1) * params.velocityAmount),
      }),
    );
    return {
      notes: [...ctx.allNotes.filter((n) => !selectedIds.has(n.id)), ...jittered],
      label: 'Jitter',
    };
  },
};
