// Domain layer — instrument layers (layers.md). Layers are a stacking/editing
// concept borrowed from photo editors (reorderable, visibility/lock,
// top-of-stack wins on overlap) layered over the single shared Note[]/
// timeline this app already has — not a second timeline concept like
// timeline.ts's event tracks. Pure functions only, no Svelte, mirroring
// arranger.ts's pattern so both store.svelte.ts and the command layer can
// use them without a runtime dependency.

import type { Layer, LayerStack, SynthSettings } from './types.js';
import { LAYER_COLORS } from './types.js';

export const DEFAULT_LAYER_NAME = 'Piano';

/**
 * The layer synthesized at store init (and never persisted anywhere prior
 * to this phase, since Phase 4/persistence.md doesn't exist yet) — wraps
 * whatever the document's previous single-instrument settings were.
 */
export function createDefaultLayer(instrument: SynthSettings): Layer {
  return {
    id: crypto.randomUUID(),
    name: DEFAULT_LAYER_NAME,
    instrument,
    color: LAYER_COLORS[0],
    visible: true,
    locked: false,
  };
}

/**
 * layers.md#rendering-and-interaction-rules: only a visible, unlocked
 * layer's notes can be selected/clicked/marquee'd/select-all'd. A missing
 * layer (e.g. a stale layerId referencing a since-deleted layer) is treated
 * as unselectable rather than throwing — callers already handle "no layer
 * found" as the note being effectively orphaned.
 */
export function isLayerSelectable(layer: Layer | undefined): boolean {
  return layer !== undefined && layer.visible && !layer.locked;
}

/** Cycles LAYER_COLORS by current layer count, so consecutive new layers default to visibly distinct colors. */
export function nextLayerColor(existing: LayerStack): string {
  return LAYER_COLORS[existing.length % LAYER_COLORS.length];
}

/**
 * Reorders layer `id` to `toIndex` (clamped in range) — reordering the
 * array *is* re-stacking (layers.md: "there's no separate z-index field to
 * keep in sync"). Returns `stack` unchanged (same reference) if `id` is
 * missing or already at `toIndex`, matching arranger.ts's no-op convention
 * so store mutators can skip recording history for a no-op drag.
 */
export function moveLayer(stack: LayerStack, id: string, toIndex: number): LayerStack {
  const fromIndex = stack.findIndex((l) => l.id === id);
  if (fromIndex === -1) return stack;
  const clampedTo = Math.max(0, Math.min(toIndex, stack.length - 1));
  if (clampedTo === fromIndex) return stack;
  const next = [...stack];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(clampedTo, 0, moved);
  return next;
}
