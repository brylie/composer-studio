// Domain layer — generated-result validation and safety limits (generators.md §14).

import { MAX_MIDI, MIN_DURATION_BEATS, MIN_MIDI } from '../types.js';
import type {
  GeneratedNoteDraft,
  GeneratorBounds,
  GeneratorDiagnostic,
  GeneratorResult,
} from './types.js';

/**
 * Shared ceiling on preview note count (generators.md §14): prevents
 * accidental UI freezes from tiny step sizes over long ranges. Exceeding it
 * is reported as a diagnostic; the caller (the evaluator) drops the preview
 * rather than silently truncating musical output.
 */
export const MAX_GENERATED_NOTES = 2000;

function isSortedByStartThenPitch(notes: GeneratedNoteDraft[]): boolean {
  for (let i = 1; i < notes.length; i++) {
    const prev = notes[i - 1];
    const curr = notes[i];
    if (curr.startBeat < prev.startBeat) return false;
    if (curr.startBeat === prev.startBeat && curr.midiNote < prev.midiNote) return false;
  }
  return true;
}

/**
 * Validates `result.notes` against global note invariants and the
 * generator's own bounds. Returns diagnostics rather than throwing or
 * mutating `result` — the caller decides what to do (e.g. dropping the
 * preview) when an `'error'`-level diagnostic is present.
 */
export function validateGeneratedResult(
  result: GeneratorResult,
  bounds: GeneratorBounds,
): GeneratorDiagnostic[] {
  const diagnostics: GeneratorDiagnostic[] = [];
  const notes = result.notes;

  if (notes.length > MAX_GENERATED_NOTES) {
    diagnostics.push({
      level: 'error',
      code: 'max-notes-exceeded',
      message: `Generated ${String(notes.length)} notes, exceeding the preview limit of ${String(MAX_GENERATED_NOTES)}.`,
    });
  }

  const seenIdentities = new Set<string>();
  for (const note of notes) {
    if (
      !Number.isFinite(note.midiNote) ||
      !Number.isFinite(note.startBeat) ||
      !Number.isFinite(note.durationBeats) ||
      !Number.isFinite(note.velocity)
    ) {
      diagnostics.push({
        level: 'error',
        code: 'non-finite-value',
        message: `Note "${note.eventKey}" has a non-finite midiNote/startBeat/durationBeats/velocity.`,
      });
      continue;
    }

    if (
      note.midiNote < MIN_MIDI ||
      note.midiNote > MAX_MIDI ||
      note.midiNote < bounds.pitch.minMidi ||
      note.midiNote > bounds.pitch.maxMidi
    ) {
      diagnostics.push({
        level: 'error',
        code: 'midi-out-of-bounds',
        message: `Note "${note.eventKey}" pitch ${String(note.midiNote)} is outside the generator's pitch bounds.`,
      });
    }

    if (note.startBeat < bounds.time.startBeat || note.startBeat >= bounds.time.endBeat) {
      diagnostics.push({
        level: 'error',
        code: 'start-out-of-bounds',
        message: `Note "${note.eventKey}" starts at ${String(note.startBeat)}, outside the generator's time bounds.`,
      });
    }

    if (note.durationBeats < MIN_DURATION_BEATS) {
      diagnostics.push({
        level: 'error',
        code: 'duration-too-short',
        message: `Note "${note.eventKey}" duration ${String(note.durationBeats)} is below the minimum.`,
      });
    }

    if (note.startBeat + note.durationBeats > bounds.time.endBeat && !bounds.allowTail) {
      diagnostics.push({
        level: 'error',
        code: 'note-exceeds-tail',
        message: `Note "${note.eventKey}" ends after the time bounds and bounds.allowTail is false.`,
      });
    }

    if (note.velocity < 1 || note.velocity > 127) {
      diagnostics.push({
        level: 'error',
        code: 'velocity-out-of-range',
        message: `Note "${note.eventKey}" velocity ${String(note.velocity)} is outside [1, 127].`,
      });
    }

    const identity = `${String(note.midiNote)}:${String(note.startBeat)}:${String(note.durationBeats)}`;
    if (seenIdentities.has(identity)) {
      diagnostics.push({
        level: 'warning',
        code: 'duplicate-note',
        message: `Duplicate note at pitch ${String(note.midiNote)}, beat ${String(note.startBeat)}, duration ${String(note.durationBeats)}.`,
      });
    }
    seenIdentities.add(identity);
  }

  if (!isSortedByStartThenPitch(notes)) {
    diagnostics.push({
      level: 'warning',
      code: 'unsorted-output',
      message: 'Generated notes are not sorted by start beat then pitch.',
    });
  }

  return diagnostics;
}
