// Domain layer — GeneratorContext construction (generators.md §5).

import type { ScaleEvent, TimeSignatureEvent } from '../timeline.js';
import type { CommandContext, Note } from '../types.js';
import type { GeneratorContext } from './types.js';

export function createGeneratorContext(
  ctx: CommandContext,
  layerNotes: Note[],
  scaleTrack: ScaleEvent[],
  timeSignatureTrack: TimeSignatureEvent[],
): GeneratorContext {
  return {
    ...ctx,
    targetLayerId: ctx.activeLayerId,
    layerNotes,
    scaleTrack,
    timeSignatureTrack,
  };
}
