export interface Note {
  id: string;
  midiNote: number;
  startBeat: number;
  durationBeats: number;
  velocity: number;
}

export interface Envelope {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export interface FilterSettings {
  enabled: boolean;
  cutoff: number;
  resonance: number;
}

export interface SynthSettings {
  waveform: OscillatorType;
  volume: number;
  envelope: Envelope;
  filter: FilterSettings;
}

export type SnapDenominator = 1 | 2 | 4 | 8 | 16;

export const NOTE_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const;

export const MIN_MIDI = 36; // C2
export const MAX_MIDI = 107; // B7
export const NOTE_COUNT = MAX_MIDI - MIN_MIDI + 1; // 72

export function isBlackKey(midiNote: number): boolean {
  return [1, 3, 6, 8, 10].includes(midiNote % 12);
}

export function noteName(midiNote: number): string {
  const octave = Math.floor(midiNote / 12) - 1;
  return `${NOTE_NAMES[midiNote % 12]}${String(octave)}`;
}

export function midiToFreq(midiNote: number): number {
  return 440 * Math.pow(2, (midiNote - 69) / 12);
}

// ── Editing model constants ────────────────────────────────────────────────────

/** Minimum note duration in beats. Not tied to snap so validity is snap-independent. */
export const MIN_DURATION_BEATS = 1 / 64;

/**
 * Enforce all Note field invariants (editing-model.md). Every mutation —
 * store methods and command run() results alike — goes through this.
 * Lives in the Domain layer so commands/*.ts can import it without
 * depending on Application state (store.svelte.ts), per architecture.md.
 */
export function clampNote(note: Note): Note {
  return {
    ...note,
    midiNote: Math.max(MIN_MIDI, Math.min(MAX_MIDI, Math.round(note.midiNote))),
    startBeat: Math.max(0, note.startBeat),
    durationBeats: Math.max(MIN_DURATION_BEATS, note.durationBeats),
    velocity: Math.max(1, Math.min(127, Math.round(note.velocity))),
  };
}

// ── Interaction mode ──────────────────────────────────────────────────────────

export type GridInteractionMode = 'draw' | 'select';

// ── Selection ─────────────────────────────────────────────────────────────────

export interface SelectionAnchor {
  /** The id of the note where a selection gesture started. Re-resolved at range-select time. */
  noteId: string;
}

export interface ClipboardContents {
  /** Positions stored relative to the earliest selected startBeat; layerId preserved as-is. */
  notes: Note[];
}

// Stubs for Phase 6 (scale track) and Phase 10 (layers) ─────────────────────

export interface ActiveScaleSegment {
  // Placeholder — real implementation in Phase 6
  scale: unknown;
  start: number;
  end: number;
}

export interface Layer {
  // Placeholder — real implementation in Phase 10
  id: string;
}

// Stub for Phase 7 (chord track) ───────────────────────────────────────────

export interface ChordEvent {
  // Placeholder — real implementation in Phase 7
  pitchClasses: number[];
  startBeat: number;
}

export interface SelectionContext {
  notes: Note[];
  count: number;
  pitchRange: { min: number; max: number } | null;
  beatRange: { start: number; end: number } | null;
  isContiguous: boolean;
  activeScales: ActiveScaleSegment[]; // [] until Phase 6
  activeLayers: Layer[]; // [] until Phase 10
}

// ── CommandContext (transformations.md) ────────────────────────────────────────

/**
 * What every CommandDescriptor.isApplicable()/run() receives. Extends
 * SelectionContext with what generators need beyond the selection itself.
 */
export interface CommandContext extends SelectionContext {
  allNotes: Note[];
  playhead: number;
  chordTrack: ChordEvent[]; // [] until Phase 7
}

// ── Command history ───────────────────────────────────────────────────────────

export interface DocumentSnapshot {
  label: string;
  notes: Note[];
  // scaleEvents, chordEvents, arrangerSections added as those tracks land (Phase 6+)
}
