// registry — transformations.md. A plain array: authored, not runtime-mutated.

import { augmentation } from './augmentation.js';
import { diminution } from './diminution.js';
import { invert } from './invert.js';
import { jitter } from './jitter.js';
import { permutation } from './permutation.js';
import { retrograde } from './retrograde.js';
import { transpose } from './transpose.js';
import type { CommandDescriptor } from './types.js';

// 'generate-chords' isn't here: it was migrated onto the shared
// recipe/operator infrastructure (generators.md §18 Phase D item 1) and now
// lives solely as generatorCatalog's generateChordsGenerator
// (generators/catalog.ts) — the old CommandDescriptor version duplicated its
// id and has been removed.
const transformCommands: CommandDescriptor[] = [
  transpose,
  retrograde,
  invert,
  augmentation,
  diminution,
  permutation,
  jitter,
];

export const commandRegistry: CommandDescriptor[] = [...transformCommands];

export * from './types.js';
