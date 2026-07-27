// Domain layer — music-theory adapter (libraries.md, architecture.md).
//
// "Wrap it, don't spray it": tonal.js's own shapes (Note/Scale/Chord
// objects, note-name strings) are used freely inside this module, but
// everything exported from here uses this app's own plain shapes (MIDI
// numbers, pitch-class sets) — nothing outside src/lib/music-theory/
// imports a `tonal`/`@tonaljs/*` package directly.

import { get as getChord } from '@tonaljs/chord';
import { get as getNote, fromMidi as noteNameFromMidi } from '@tonaljs/note';
import { get as getScale } from '@tonaljs/scale';
import { topNoteDiff } from '@tonaljs/voice-leading';

/** A named octave range, e.g. { min: 3, max: 5 } — generate-chords's octaveRange param. */
export interface OctaveRange {
  min: number;
  max: number;
}

function chromaOf(noteName: string): number {
  return getNote(noteName).chroma;
}

/** Pitch classes (0-11) belonging to a named scale, e.g. pitchClassesForScale('C', 'major'). */
export function pitchClassesForScale(root: string, mode: string): Set<number> {
  const scale = getScale(`${root} ${mode}`);
  return new Set(scale.notes.map(chromaOf));
}

/** Pitch classes (0-11) belonging to a named chord, e.g. pitchClassesForChord('C', 'maj7'). */
export function pitchClassesForChord(root: string, quality: string): Set<number> {
  const chord = getChord(`${root}${quality}`);
  return new Set(chord.notes.map(chromaOf));
}

/** MIDI note number at the bottom of scientific-pitch-notation octave `octave` (C at that octave). */
function octaveFloorMidi(octave: number): number {
  return 12 * (octave + 1);
}

/**
 * Voices a pitch-class set as MIDI note numbers within `octaveRange`,
 * choosing `voiceCount` notes. When `previousVoicing` is given, notes are
 * assigned to minimize movement from it (smooth voice leading) instead of
 * being spread in closed position from the bottom of the range — used by
 * generate-chords (transformations.md) to keep consecutive chords from
 * jumping around. Falls back to fewer notes than `voiceCount` if the range
 * doesn't contain enough distinct candidates.
 */
export function voiceChord(
  pitchClasses: ReadonlySet<number>,
  octaveRange: OctaveRange,
  voiceCount: number,
  previousVoicing: number[] | null,
): number[] {
  if (pitchClasses.size === 0 || voiceCount <= 0) return [];

  const minMidi = octaveFloorMidi(octaveRange.min);
  const maxMidi = octaveFloorMidi(octaveRange.max + 1) - 1;
  const candidates: number[] = [];
  for (let midi = minMidi; midi <= maxMidi; midi++) {
    if (pitchClasses.has(midi % 12)) candidates.push(midi);
  }
  if (candidates.length === 0) return [];

  let voicing: number[];
  if (!previousVoicing || previousVoicing.length === 0) {
    // First chord: closed voicing, spread evenly from the bottom of the range.
    // If there are fewer candidates than voiceCount, return only the distinct
    // candidates available rather than duplicating the final one.
    voicing = [];
    const count = Math.min(voiceCount, candidates.length);
    for (let i = 0; i < count; i++) {
      voicing.push(candidates[i]);
    }
  } else {
    // Greedily assign each previous voice to its nearest still-available
    // candidate, minimizing per-voice movement.
    const pool = [...candidates];
    const sourceVoices =
      previousVoicing.length >= voiceCount
        ? previousVoicing.slice(-voiceCount)
        : [
            ...previousVoicing,
            ...Array<number>(voiceCount - previousVoicing.length).fill(
              previousVoicing[previousVoicing.length - 1],
            ),
          ];

    voicing = [];
    for (const prev of sourceVoices) {
      if (pool.length === 0) break;
      let bestIndex = 0;
      let bestDistance = Math.abs(pool[0] - prev);
      for (let i = 1; i < pool.length; i++) {
        const distance = Math.abs(pool[i] - prev);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = i;
        }
      }
      voicing.push(pool[bestIndex]);
      pool.splice(bestIndex, 1);
    }

    // Smooth the top voice specifically using @tonaljs/voice-leading: if an
    // octave-shifted alternative for the top note is also in range, let
    // topNoteDiff decide which one continues more smoothly from the
    // previous top note. The top voice is whichever note has the highest
    // MIDI value, not necessarily the last element (assignment order above
    // follows previousVoicing's order, which the greedy nearest-neighbor
    // pass can leave out of pitch order).
    if (voicing.length > 0) {
      let topIndex = 0;
      for (let i = 1; i < voicing.length; i++) {
        if (voicing[i] > voicing[topIndex]) topIndex = i;
      }
      const currentTop = voicing[topIndex];
      const octaveDown = currentTop - 12;
      const octaveUp = currentTop + 12;
      const otherVoices = new Set(voicing.filter((_, i) => i !== topIndex));
      const alt = [octaveDown, octaveUp].find(
        (m) => m >= minMidi && m <= maxMidi && pitchClasses.has(m % 12) && !otherVoices.has(m),
      );
      if (alt !== undefined) {
        const lastTop = [noteNameFromMidi(previousVoicing[previousVoicing.length - 1])];
        const options = [[noteNameFromMidi(currentTop)], [noteNameFromMidi(alt)]];
        const chosenName = topNoteDiff(options, lastTop)[0];
        const chosenMidi = getNote(chosenName).midi;
        if (chosenMidi !== null && !otherVoices.has(chosenMidi)) {
          voicing[topIndex] = chosenMidi;
        }
      }
    }
  }

  // Defensive dedupe: no two voices should share the same MIDI number, even if an
  // edge case above (or a future change) would otherwise let one slip through.
  return [...new Set(voicing)].sort((a, b) => a - b);
}
