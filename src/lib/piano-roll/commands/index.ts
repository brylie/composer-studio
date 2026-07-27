// registry — transformations.md. A plain array: authored, not runtime-mutated.

import { augmentation } from './augmentation.js';
import { diminution } from './diminution.js';
import { generateChords } from './generate-chords.js';
import { invert } from './invert.js';
import { jitter } from './jitter.js';
import { permutation } from './permutation.js';
import { retrograde } from './retrograde.js';
import { transpose } from './transpose.js';
import type { CommandDescriptor } from './types.js';

const transformCommands: CommandDescriptor[] = [
  transpose,
  retrograde,
  invert,
  augmentation,
  diminution,
  permutation,
  jitter,
];

const generateCommands: CommandDescriptor[] = [generateChords];

export const commandRegistry: CommandDescriptor[] = [...transformCommands, ...generateCommands];

export * from './types.js';
