import type { CommandContext, Note } from '../types.js';
import type { CommandDescriptor } from './types.js';

/** Builds a Note fixture with sensible defaults, overridable per-field. */
export function makeNote(overrides: Partial<Note> & { id: string }): Note {
  return {
    midiNote: 60,
    startBeat: 0,
    durationBeats: 1,
    velocity: 100,
    layerId: 'layer-default',
    ...overrides,
  };
}

/**
 * Builds a CommandContext from a full note list and a set of selected ids,
 * mirroring store.svelte.ts's selectionContext/commandContext derivation
 * closely enough for command unit tests without needing a Svelte runtime.
 */
export function makeCommandContext(
  allNotes: Note[],
  selectedIds: Set<string>,
  overrides: Partial<Pick<CommandContext, 'playhead' | 'chordTrack' | 'activeLayerId'>> = {},
): CommandContext {
  const selected = allNotes
    .filter((n) => selectedIds.has(n.id))
    .sort((a, b) => a.startBeat - b.startBeat || a.midiNote - b.midiNote);

  const count = selected.length;
  let pitchRange: { min: number; max: number } | null = null;
  let beatRange: { start: number; end: number } | null = null;

  if (count > 0) {
    let minPitch = Infinity,
      maxPitch = -Infinity;
    let minBeat = Infinity,
      maxBeat = -Infinity;
    for (const n of selected) {
      if (n.midiNote < minPitch) minPitch = n.midiNote;
      if (n.midiNote > maxPitch) maxPitch = n.midiNote;
      if (n.startBeat < minBeat) minBeat = n.startBeat;
      const end = n.startBeat + n.durationBeats;
      if (end > maxBeat) maxBeat = end;
    }
    pitchRange = { min: minPitch, max: maxPitch };
    beatRange = { start: minBeat, end: maxBeat };
  }

  return {
    notes: selected,
    count,
    pitchRange,
    beatRange,
    isContiguous: true, // not exercised by command tests; isContiguous has its own coverage in store.spec.ts
    activeScales: [],
    activeLayers: [],
    allNotes,
    playhead: overrides.playhead ?? 0,
    chordTrack: overrides.chordTrack ?? [],
    activeLayerId: overrides.activeLayerId ?? 'layer-default',
  };
}

/**
 * Calls a command's `run()` in tests without a non-null assertion. Throws if
 * the descriptor is an `effect`-only command (there are none in the current
 * registry, so this only guards against future misuse).
 */
export function runCommand<TParams extends Record<string, unknown>>(
  command: CommandDescriptor<TParams>,
  ctx: CommandContext,
  params: TParams,
): { notes: Note[]; label: string } {
  if (!command.run) {
    throw new Error(`Command "${command.id}" has no run() — it is effect-only.`);
  }
  return command.run(ctx, params);
}

/** Finds a note by id in a test result, throwing (rather than asserting non-null) if missing. */
export function findNoteById(notes: Note[], id: string): Note {
  const note = notes.find((n) => n.id === id);
  if (!note) {
    throw new Error(`Expected to find note with id "${id}"`);
  }
  return note;
}
