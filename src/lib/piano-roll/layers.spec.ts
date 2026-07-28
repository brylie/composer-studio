import { describe, expect, it } from 'vitest';
import { createDefaultLayer, isLayerSelectable, moveLayer, nextLayerColor } from './layers.js';
import type { Layer, LayerStack } from './types.js';
import { DEFAULT_SYNTH, LAYER_COLORS } from './types.js';

function makeLayer(overrides: Partial<Layer> & { id: string }): Layer {
  return {
    name: 'Layer',
    instrument: DEFAULT_SYNTH,
    color: LAYER_COLORS[0],
    visible: true,
    locked: false,
    ...overrides,
  };
}

describe('createDefaultLayer', () => {
  it('wraps the given instrument settings into a visible, unlocked "Piano" layer', () => {
    const layer = createDefaultLayer(DEFAULT_SYNTH);
    expect(layer.name).toBe('Piano');
    expect(layer.instrument).toBe(DEFAULT_SYNTH);
    expect(layer.visible).toBe(true);
    expect(layer.locked).toBe(false);
    expect(layer.id).toBeTruthy();
    expect(layer.color).toBe(LAYER_COLORS[0]);
  });

  it('gives each call a distinct id', () => {
    const a = createDefaultLayer(DEFAULT_SYNTH);
    const b = createDefaultLayer(DEFAULT_SYNTH);
    expect(a.id).not.toBe(b.id);
  });
});

describe('isLayerSelectable', () => {
  it('is true for a visible, unlocked layer', () => {
    expect(isLayerSelectable(makeLayer({ id: 'a', visible: true, locked: false }))).toBe(true);
  });

  it('is false for a visible, locked layer', () => {
    expect(isLayerSelectable(makeLayer({ id: 'a', visible: true, locked: true }))).toBe(false);
  });

  it('is false for a hidden, unlocked layer', () => {
    expect(isLayerSelectable(makeLayer({ id: 'a', visible: false, locked: false }))).toBe(false);
  });

  it('is false for a hidden, locked layer', () => {
    expect(isLayerSelectable(makeLayer({ id: 'a', visible: false, locked: true }))).toBe(false);
  });

  it('is false for a missing (undefined) layer', () => {
    expect(isLayerSelectable(undefined)).toBe(false);
  });
});

describe('nextLayerColor', () => {
  it('returns the first palette color for an empty stack', () => {
    expect(nextLayerColor([])).toBe(LAYER_COLORS[0]);
  });

  it('cycles the palette by current layer count', () => {
    const stack: LayerStack = [makeLayer({ id: 'a' })];
    expect(nextLayerColor(stack)).toBe(LAYER_COLORS[1]);
  });

  it('wraps around once the stack is longer than the palette', () => {
    const stack: LayerStack = Array.from({ length: LAYER_COLORS.length }, (_, i) =>
      makeLayer({ id: `l${String(i)}` }),
    );
    expect(nextLayerColor(stack)).toBe(LAYER_COLORS[0]);
  });
});

describe('moveLayer', () => {
  const stack: LayerStack = [
    makeLayer({ id: 'a' }),
    makeLayer({ id: 'b' }),
    makeLayer({ id: 'c' }),
  ];

  it('moves a layer to a later index, shifting the others up', () => {
    const result = moveLayer(stack, 'a', 2);
    expect(result.map((l) => l.id)).toEqual(['b', 'c', 'a']);
  });

  it('moves a layer to an earlier index, shifting the others down', () => {
    const result = moveLayer(stack, 'c', 0);
    expect(result.map((l) => l.id)).toEqual(['c', 'a', 'b']);
  });

  it('returns the same reference (no-op) when the layer is already at toIndex', () => {
    const result = moveLayer(stack, 'b', 1);
    expect(result).toBe(stack);
  });

  it('returns the same reference (no-op) for an unknown layer id', () => {
    const result = moveLayer(stack, 'missing', 0);
    expect(result).toBe(stack);
  });

  it('clamps an out-of-range toIndex to the stack bounds', () => {
    const result = moveLayer(stack, 'a', 99);
    expect(result.map((l) => l.id)).toEqual(['b', 'c', 'a']);
  });
});
