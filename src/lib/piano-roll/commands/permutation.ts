import { createSeededRandom } from '../random.js';
import type { CommandContext } from '../types.js';
import { clampNote } from '../types.js';
import type { CommandDescriptor } from './types.js';

export interface PermutationParams extends Record<string, unknown> {
  seed: number;
}

/** Shuffles selected notes' pitches across their existing time slots (Fisher-Yates, seeded). */
export const permutation: CommandDescriptor<PermutationParams> = {
  id: 'permutation',
  category: 'transform',
  labelKey: 'commands.permutation.label',
  icon: 'shuffle',
  params: [
    { key: 'seed', label: 'Seed', type: 'number', min: 0, max: 999999, step: 1, default: 1 },
  ],
  isApplicable(ctx: CommandContext) {
    return ctx.count >= 2;
  },
  getDisabledReasonKey() {
    return 'commands.disabled.selectAtLeastTwo';
  },
  run(ctx: CommandContext, params: PermutationParams) {
    const random = createSeededRandom(params.seed);
    const slots = ctx.notes.map((n) => ({
      startBeat: n.startBeat,
      durationBeats: n.durationBeats,
    }));
    const pitches = ctx.notes.map((n) => n.midiNote);

    for (let i = pitches.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [pitches[i], pitches[j]] = [pitches[j], pitches[i]];
    }

    const selectedIds = new Set(ctx.notes.map((n) => n.id));
    const permuted = ctx.notes.map((n, i) =>
      clampNote({
        ...n,
        startBeat: slots[i].startBeat,
        durationBeats: slots[i].durationBeats,
        midiNote: pitches[i],
      }),
    );
    return {
      notes: [...ctx.allNotes.filter((n) => !selectedIds.has(n.id)), ...permuted],
      label: 'Permutation',
    };
  },
};
