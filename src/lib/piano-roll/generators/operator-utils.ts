// Domain layer — small numeric clamp helpers shared by every operator file
// (generators.md §5, §14). Each simply enforces one of
// validateGeneratedResult's invariants (MIDI range, velocity range, pitch
// bounds) at the point of generation, so an operator's own output rarely
// trips a diagnostic in the first place.

import { MAX_MIDI, MIN_MIDI } from '../types.js';
import type { GeneratorBounds } from './types.js';

export function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function clampMidi(value: number): number {
  return Math.max(MIN_MIDI, Math.min(MAX_MIDI, Math.round(value)));
}

export function clampVelocity(value: number): number {
  return Math.max(1, Math.min(127, Math.round(value)));
}

export function clampToPitchBounds(midiNote: number, bounds: GeneratorBounds): number {
  return Math.max(bounds.pitch.minMidi, Math.min(bounds.pitch.maxMidi, midiNote));
}
