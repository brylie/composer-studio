// Domain layer — GeneratorContext construction (generators.md §5).

import type { ScaleEvent, TimeSignatureEvent } from '../timeline.js';
import type { CommandContext, Note } from '../types.js';
import type { GeneratorContext } from './types.js';

export function createGeneratorContext(
  ctx: CommandContext,
  layerNotes: Note[],
  scaleTrack: ScaleEvent[],
  timeSignatureTrack: TimeSignatureEvent[],
  // Defaults to the active layer so existing single-layer callers/tests are
  // unaffected, but a session targeting a non-active layer must pass its own
  // targetLayerId explicitly — otherwise the context silently describes the
  // wrong layer while layerNotes is correctly filtered by the right one.
  targetLayerId: string = ctx.activeLayerId,
): GeneratorContext {
  return {
    ...ctx,
    targetLayerId,
    layerNotes,
    scaleTrack,
    timeSignatureTrack,
  };
}
