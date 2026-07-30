// Domain layer — small numeric clamp helpers shared by every operator file
// (generators.md §5, §14). Each simply enforces one of
// validateGeneratedResult's invariants (MIDI range, velocity range, pitch
// bounds) at the point of generation, so an operator's own output rarely
// trips a diagnostic in the first place.

import { MAX_MIDI, MIN_DURATION_BEATS, MIN_MIDI } from '../types.js';
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

/** A Euclidean pattern's step count, clamped to at least one step. */
export function clampSteps(value: unknown, fallback: number): number {
  const num = Number(value ?? fallback);
  return Math.max(1, Math.round(Number.isFinite(num) ? num : fallback));
}

/** A Euclidean pattern's pulse count, clamped to `[0, steps]`. */
export function clampPulses(value: unknown, steps: number, fallback: number): number {
  const num = Number(value ?? fallback);
  return Math.max(0, Math.min(steps, Math.round(Number.isFinite(num) ? num : fallback)));
}

/**
 * An onset's duration once gated to `rawDuration` and clamped so it never
 * runs past `bounds.time.endBeat` unless the bounds allow a tail — the
 * "gate then clamp to remaining bounds" arithmetic pulse-source and
 * euclidean-source both need for a step starting at `startBeat`.
 */
export function gatedDuration(
  rawDuration: number,
  startBeat: number,
  bounds: GeneratorBounds,
): number {
  const gated = Math.max(MIN_DURATION_BEATS, rawDuration);
  return bounds.allowTail ? gated : Math.min(gated, bounds.time.endBeat - startBeat);
}
