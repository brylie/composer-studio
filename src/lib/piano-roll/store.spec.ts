import { beforeEach, describe, expect, it } from 'vitest';
import { CommandHistory, isContiguous } from './history.js';
import { createStore } from './store.svelte.js';
import {
  MAX_MIDI,
  MIN_DURATION_BEATS,
  MIN_MIDI,
  isBlackKey,
  midiToFreq,
  noteName,
} from './types.js';

// ── types.ts utilities ────────────────────────────────────────────────────────

describe('isBlackKey', () => {
  it('returns true for sharps (C#, D#, F#, G#, A#)', () => {
    expect(isBlackKey(61)).toBe(true); // C#4
    expect(isBlackKey(63)).toBe(true); // D#4
    expect(isBlackKey(66)).toBe(true); // F#4
  });

  it('returns false for naturals (C, D, E, F, G, A, B)', () => {
    expect(isBlackKey(60)).toBe(false); // C4
    expect(isBlackKey(62)).toBe(false); // D4
    expect(isBlackKey(64)).toBe(false); // E4
  });
});

describe('noteName', () => {
  it('returns correct name for C4 (MIDI 60)', () => {
    expect(noteName(60)).toBe('C4');
  });

  it('returns correct name for A4 (MIDI 69)', () => {
    expect(noteName(69)).toBe('A4');
  });
});

describe('midiToFreq', () => {
  it('returns 440 Hz for A4 (MIDI 69)', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 2);
  });

  it('returns half the frequency one octave lower', () => {
    expect(midiToFreq(57)).toBeCloseTo(220, 2); // A3
  });
});

// ── isContiguous ──────────────────────────────────────────────────────────────

describe('isContiguous', () => {
  it('returns true for an empty array', () => {
    expect(isContiguous([])).toBe(true);
  });

  it('returns true for a single note', () => {
    const note = { id: '1', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 };
    expect(isContiguous([note])).toBe(true);
  });

  it('returns true for adjacent notes with no gap', () => {
    const notes = [
      { id: '1', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 },
      { id: '2', midiNote: 62, startBeat: 1, durationBeats: 1, velocity: 100 },
    ];
    expect(isContiguous(notes)).toBe(true);
  });

  it('returns false when there is a gap between notes', () => {
    const notes = [
      { id: '1', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 },
      { id: '2', midiNote: 62, startBeat: 2, durationBeats: 1, velocity: 100 }, // gap at beat 1
    ];
    expect(isContiguous(notes)).toBe(false);
  });

  it('returns true for overlapping notes', () => {
    const notes = [
      { id: '1', midiNote: 60, startBeat: 0, durationBeats: 2, velocity: 100 },
      { id: '2', midiNote: 62, startBeat: 1, durationBeats: 2, velocity: 100 },
    ];
    expect(isContiguous(notes)).toBe(true);
  });

  it('handles the covering-note edge case (union, not pairwise)', () => {
    // A 10-beat note at 0, a 2-beat note at 2 (nested), then a note starting at 10.
    // Naive pairwise: note[0].end=10, note[1].start=2 → gap reported (wrong).
    // Union-coverage: coveredUntil reaches 10, note at 10 is touching → no gap.
    const notes = [
      { id: '1', midiNote: 60, startBeat: 0, durationBeats: 10, velocity: 100 },
      { id: '2', midiNote: 62, startBeat: 2, durationBeats: 2, velocity: 100 },
      { id: '3', midiNote: 64, startBeat: 10, durationBeats: 1, velocity: 100 },
    ];
    expect(isContiguous(notes)).toBe(true);
  });
});

// ── CommandHistory ────────────────────────────────────────────────────────────

describe('CommandHistory', () => {
  let history: CommandHistory;

  beforeEach(() => {
    history = new CommandHistory();
  });

  it('starts with canUndo=false and canRedo=false', () => {
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  it('canUndo becomes true after record()', () => {
    history.record('Test', () => ({ notes: [], scaleEvents: [] }));
    expect(history.canUndo).toBe(true);
  });

  it('record() clears the redo stack', () => {
    history.record('A', () => ({ notes: [], scaleEvents: [] }));
    history.undo(() => ({ notes: [], scaleEvents: [] }));
    expect(history.canRedo).toBe(true);
    history.record('B', () => ({ notes: [], scaleEvents: [] }));
    expect(history.canRedo).toBe(false);
  });

  it('undo() returns the recorded snapshot and sets canRedo=true', () => {
    const snap = {
      notes: [{ id: '1', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 }],
      scaleEvents: [],
    };
    history.record('Transpose', () => snap);
    const entry = history.undo(() => ({ notes: [], scaleEvents: [] }));
    expect(entry?.label).toBe('Transpose');
    expect(entry?.notes).toEqual(snap.notes);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
  });

  it('redo() returns the snapshot and restores canUndo', () => {
    history.record('Move', () => ({ notes: [], scaleEvents: [] }));
    history.undo(() => ({ notes: [], scaleEvents: [] }));
    const entry = history.redo(() => ({ notes: [], scaleEvents: [] }));
    expect(entry?.label).toBe('Move');
    expect(history.canRedo).toBe(false);
    expect(history.canUndo).toBe(true);
  });

  it('undo() returns undefined when stack is empty', () => {
    expect(history.undo(() => ({ notes: [], scaleEvents: [] }))).toBeUndefined();
  });

  it('redo() returns undefined when stack is empty', () => {
    expect(history.redo(() => ({ notes: [], scaleEvents: [] }))).toBeUndefined();
  });

  it('trims undo stack to maxDepth (50)', () => {
    for (let i = 0; i < 55; i++) {
      history.record(`Step ${String(i)}`, () => ({ notes: [], scaleEvents: [] }));
    }
    // pop 50 times — should all succeed
    for (let i = 0; i < 50; i++) {
      const entry = history.undo(() => ({ notes: [], scaleEvents: [] }));
      expect(entry).toBeDefined();
    }
    // 51st pop must return undefined (stack was trimmed to 50)
    expect(history.undo(() => ({ notes: [], scaleEvents: [] }))).toBeUndefined();
  });

  it('exposes undoLabel and redoLabel', () => {
    history.record('First', () => ({ notes: [], scaleEvents: [] }));
    expect(history.undoLabel).toBe('First');
    history.undo(() => ({ notes: [], scaleEvents: [] }));
    expect(history.redoLabel).toBe('First');
  });
});

// ── createStore — mutation invariants ────────────────────────────────────────

describe('createStore — mutation invariants', () => {
  it('clamps midiNote below MIN_MIDI on addNote', () => {
    const store = createStore();
    store.addNote({ id: '1', midiNote: 0, startBeat: 0, durationBeats: 1, velocity: 100 });
    expect(store.notes[0].midiNote).toBe(MIN_MIDI);
  });

  it('clamps midiNote above MAX_MIDI on addNote', () => {
    const store = createStore();
    store.addNote({ id: '1', midiNote: 999, startBeat: 0, durationBeats: 1, velocity: 100 });
    expect(store.notes[0].midiNote).toBe(MAX_MIDI);
  });

  it('clamps startBeat to >= 0 on addNote', () => {
    const store = createStore();
    store.addNote({ id: '1', midiNote: 60, startBeat: -5, durationBeats: 1, velocity: 100 });
    expect(store.notes[0].startBeat).toBe(0);
  });

  it('clamps durationBeats to >= MIN_DURATION_BEATS on addNote', () => {
    const store = createStore();
    store.addNote({ id: '1', midiNote: 60, startBeat: 0, durationBeats: 0, velocity: 100 });
    expect(store.notes[0].durationBeats).toBe(MIN_DURATION_BEATS);
  });

  it('clamps velocity to [1, 127] on addNote', () => {
    const store = createStore();
    store.addNote({ id: 'a', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 0 });
    store.addNote({ id: 'b', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 200 });
    expect(store.notes[0].velocity).toBe(1);
    expect(store.notes[1].velocity).toBe(127);
  });

  it('clamps midiNote on updateNote', () => {
    const store = createStore();
    store.addNote({ id: '1', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 });
    store.updateNote('1', { midiNote: 200 });
    expect(store.notes[0].midiNote).toBe(MAX_MIDI);
  });

  it('auto-extends totalBeats when a note exceeds the current length', () => {
    const store = createStore();
    const initialBeats = store.totalBeats; // 64
    store.addNote({ id: '1', midiNote: 60, startBeat: 60, durationBeats: 8, velocity: 100 });
    expect(store.totalBeats).toBeGreaterThan(initialBeats);
    // Should be rounded up to next 4-beat bar: ceil(68/4)*4 = 68
    expect(store.totalBeats % 4).toBe(0);
    expect(store.totalBeats).toBeGreaterThanOrEqual(68);
  });

  it('does not extend totalBeats when note fits', () => {
    const store = createStore();
    const initialBeats = store.totalBeats;
    store.addNote({ id: '1', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 });
    expect(store.totalBeats).toBe(initialBeats);
  });

  it('ignores duplicate note IDs', () => {
    const store = createStore();
    store.addNote({ id: 'x', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 });
    store.addNote({ id: 'x', midiNote: 62, startBeat: 1, durationBeats: 1, velocity: 100 });
    expect(store.notes.length).toBe(1);
  });
});

// ── createStore — SvelteSet selection ────────────────────────────────────────

describe('createStore — selection', () => {
  it('selectNote exclusive: clears others', () => {
    const store = createStore();
    store.addNote({ id: 'a', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 });
    store.addNote({ id: 'b', midiNote: 62, startBeat: 1, durationBeats: 1, velocity: 100 });
    store.selectNote('a', false);
    store.selectNote('b', false);
    expect(store.selectedNoteIds.has('a')).toBe(false);
    expect(store.selectedNoteIds.has('b')).toBe(true);
    expect(store.selectedNoteIds.size).toBe(1);
  });

  it('selectNote toggle: adds when absent', () => {
    const store = createStore();
    store.addNote({ id: 'a', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 });
    store.selectNote('a', true);
    expect(store.selectedNoteIds.has('a')).toBe(true);
  });

  it('selectNote toggle: removes when present', () => {
    const store = createStore();
    store.addNote({ id: 'a', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 });
    store.selectNote('a', true);
    store.selectNote('a', true);
    expect(store.selectedNoteIds.has('a')).toBe(false);
  });

  it('selectAll selects every note', () => {
    const store = createStore();
    store.addNote({ id: 'a', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 });
    store.addNote({ id: 'b', midiNote: 62, startBeat: 1, durationBeats: 1, velocity: 100 });
    store.selectAll();
    expect(store.selectedNoteIds.size).toBe(2);
  });

  it('deselectAll clears selection and anchor', () => {
    const store = createStore();
    store.addNote({ id: 'a', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 });
    store.selectNote('a', false);
    store.setAnchor('a');
    store.deselectAll();
    expect(store.selectedNoteIds.size).toBe(0);
    expect(store.selectionAnchor).toBeNull();
  });

  it('selectNotes replaces when addToSelection=false', () => {
    const store = createStore();
    store.addNote({ id: 'a', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 });
    store.addNote({ id: 'b', midiNote: 62, startBeat: 1, durationBeats: 1, velocity: 100 });
    store.selectNote('a', false);
    store.selectNotes(['b'], false);
    expect(store.selectedNoteIds.has('a')).toBe(false);
    expect(store.selectedNoteIds.has('b')).toBe(true);
  });

  it('selectNotes adds when addToSelection=true', () => {
    const store = createStore();
    store.addNote({ id: 'a', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 });
    store.addNote({ id: 'b', midiNote: 62, startBeat: 1, durationBeats: 1, velocity: 100 });
    store.selectNote('a', false);
    store.selectNotes(['b'], true);
    expect(store.selectedNoteIds.size).toBe(2);
  });

  it('setAnchor / clearAnchor update selectionAnchor', () => {
    const store = createStore();
    store.setAnchor('n1');
    expect(store.selectionAnchor?.noteId).toBe('n1');
    store.clearAnchor();
    expect(store.selectionAnchor).toBeNull();
  });

  it('selectRange with no anchor falls back to single-select', () => {
    const store = createStore();
    store.addNote({ id: 'a', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 });
    store.selectRange('a');
    expect(store.selectedNoteIds.has('a')).toBe(true);
    expect(store.selectedNoteIds.size).toBe(1);
  });

  it('selectRange selects inclusive range between anchor and focus', () => {
    const store = createStore();
    store.addNote({ id: 'a', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 });
    store.addNote({ id: 'b', midiNote: 62, startBeat: 1, durationBeats: 1, velocity: 100 });
    store.addNote({ id: 'c', midiNote: 64, startBeat: 2, durationBeats: 1, velocity: 100 });
    store.setAnchor('a');
    store.selectRange('c');
    expect(store.selectedNoteIds.size).toBe(3);
    expect(store.selectedNoteIds.has('a')).toBe(true);
    expect(store.selectedNoteIds.has('b')).toBe(true);
    expect(store.selectedNoteIds.has('c')).toBe(true);
  });

  it('removeNote removes the note from selection', () => {
    const store = createStore();
    store.addNote({ id: 'a', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 });
    store.selectNote('a', false);
    store.removeNote('a');
    expect(store.selectedNoteIds.has('a')).toBe(false);
  });

  it('deleteSelected removes selected notes and records history', () => {
    const store = createStore();
    store.addNote({ id: 'a', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 });
    store.addNote({ id: 'b', midiNote: 62, startBeat: 1, durationBeats: 1, velocity: 100 });
    store.selectNote('a', false);
    store.deleteSelected();
    expect(store.notes.length).toBe(1);
    expect(store.notes[0].id).toBe('b');
    expect(store.history.canUndo).toBe(true);
  });
});

// ── createStore — SelectionContext ────────────────────────────────────────────

describe('createStore — selectionContext', () => {
  it('count=0 and null ranges when nothing is selected', () => {
    const store = createStore();
    const ctx = store.selectionContext;
    expect(ctx.count).toBe(0);
    expect(ctx.pitchRange).toBeNull();
    expect(ctx.beatRange).toBeNull();
  });

  it('derives correct pitchRange and beatRange', () => {
    const store = createStore();
    store.addNote({ id: 'a', midiNote: 60, startBeat: 1, durationBeats: 2, velocity: 100 });
    store.addNote({ id: 'b', midiNote: 72, startBeat: 3, durationBeats: 1, velocity: 100 });
    store.selectAll();
    const ctx = store.selectionContext;
    expect(ctx.pitchRange).toEqual({ min: 60, max: 72 });
    expect(ctx.beatRange).toEqual({ start: 1, end: 4 });
  });

  it('isContiguous is false when selected notes have a gap', () => {
    const store = createStore();
    store.addNote({ id: 'a', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 });
    store.addNote({ id: 'b', midiNote: 62, startBeat: 3, durationBeats: 1, velocity: 100 }); // gap
    store.selectAll();
    expect(store.selectionContext.isContiguous).toBe(false);
  });
});

// ── createStore — commandContext ──────────────────────────────────────────────

describe('createStore — commandContext', () => {
  it('extends selectionContext with allNotes, playhead, and an empty chordTrack stub', () => {
    const store = createStore();
    store.addNote({ id: 'a', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 });
    store.addNote({ id: 'b', midiNote: 64, startBeat: 1, durationBeats: 1, velocity: 100 });
    store.selectNote('a', false);

    const ctx = store.commandContext;
    expect(ctx.allNotes).toHaveLength(2);
    expect(ctx.playhead).toBe(store.currentBeat);
    expect(ctx.chordTrack).toEqual([]);
    // still carries the selection-derived fields
    expect(ctx.count).toBe(1);
    expect(ctx.notes[0].id).toBe('a');
  });
});

// ── createStore — executeCommand ───────────────────────────────────────────

describe('createStore — executeCommand', () => {
  it('runs a registry command with params and records history', () => {
    const store = createStore();
    store.addNote({ id: 'a', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 });
    store.selectNote('a', false);

    const executed = store.executeCommand('transpose', { semitones: 5 });

    expect(executed).toBe(true);
    expect(store.notes[0].midiNote).toBe(65);
    expect(store.history.canUndo).toBe(true);
    expect(store.history.undoLabel).toBe('Transpose +5');
  });

  it('returns false and leaves notes/history untouched for an unknown command', () => {
    const store = createStore();
    store.addNote({ id: 'a', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 });
    store.selectNote('a', false);

    const executed = store.executeCommand('not-a-real-command', { semitones: 5 });

    expect(executed).toBe(false);
    expect(store.notes[0].midiNote).toBe(60);
    expect(store.history.canUndo).toBe(false);
  });

  it('returns false and leaves notes/history untouched for an inapplicable command', () => {
    const store = createStore();
    store.addNote({ id: 'a', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 });
    // No selection, so transpose (requires selectAtLeastOne) is inapplicable.

    const executed = store.executeCommand('transpose', { semitones: 5 });

    expect(executed).toBe(false);
    expect(store.notes[0].midiNote).toBe(60);
    expect(store.history.canUndo).toBe(false);
  });
});

// ── createStore — applyCommandResult ──────────────────────────────────────────

describe('createStore — applyCommandResult', () => {
  it('replaces the notes array with the (clamped) command result', () => {
    const store = createStore();
    store.addNote({ id: 'a', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 });

    store.applyCommandResult({
      notes: [{ id: 'a', midiNote: 999, startBeat: -5, durationBeats: 0, velocity: 200 }],
      label: 'Test command',
    });

    expect(store.notes).toHaveLength(1);
    expect(store.notes[0].midiNote).toBe(MAX_MIDI);
    expect(store.notes[0].startBeat).toBe(0);
    expect(store.notes[0].durationBeats).toBe(MIN_DURATION_BEATS);
    expect(store.notes[0].velocity).toBe(127);
  });

  it('records history so undo() restores the pre-command notes', () => {
    const store = createStore();
    store.addNote({ id: 'a', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 });

    store.applyCommandResult({
      notes: [{ id: 'a', midiNote: 65, startBeat: 0, durationBeats: 1, velocity: 100 }],
      label: 'Transpose',
    });
    expect(store.notes[0].midiNote).toBe(65);
    expect(store.history.canUndo).toBe(true);
    expect(store.history.undoLabel).toBe('Transpose');

    store.undo();
    expect(store.notes[0].midiNote).toBe(60);
  });

  it('extends totalBeats when the command result has notes beyond the current end', () => {
    const store = createStore();
    const initialBeats = store.totalBeats;
    store.applyCommandResult({
      notes: [{ id: 'a', midiNote: 60, startBeat: 60, durationBeats: 8, velocity: 100 }],
      label: 'Grow',
    });
    expect(store.totalBeats).toBeGreaterThan(initialBeats);
  });

  it('prunes selection to only notes that still exist after the command result', () => {
    const store = createStore();
    store.addNote({ id: 'a', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 });
    store.addNote({ id: 'b', midiNote: 62, startBeat: 1, durationBeats: 1, velocity: 100 });
    store.selectAll();
    expect(store.selectionContext.count).toBe(2);

    store.applyCommandResult({
      notes: [{ id: 'a', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 }],
      label: 'Remove one',
    });

    expect(store.selectionContext.count).toBe(1);
    expect(store.selectionContext.notes[0].id).toBe('a');
  });
});

// ── createStore — clipboard ───────────────────────────────────────────────────

describe('createStore — clipboard', () => {
  it('copy normalizes startBeats to 0-relative', () => {
    const store = createStore();
    store.addNote({ id: 'a', midiNote: 60, startBeat: 4, durationBeats: 1, velocity: 100 });
    store.addNote({ id: 'b', midiNote: 62, startBeat: 5, durationBeats: 1, velocity: 100 });
    store.selectAll();
    store.copy();
    expect(store.clipboard?.notes[0].startBeat).toBe(0);
    expect(store.clipboard?.notes[1].startBeat).toBe(1);
  });

  it('copy does nothing when selection is empty', () => {
    const store = createStore();
    store.copy();
    expect(store.clipboard).toBeNull();
  });

  it('paste inserts notes at atBeat, selects them, records history', () => {
    const store = createStore();
    store.addNote({ id: 'a', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 });
    store.selectAll();
    store.copy();
    store.deselectAll();
    store.paste(8);
    expect(store.notes.length).toBe(2);
    const pasted = store.notes.find((n) => n.startBeat === 8);
    expect(pasted).toBeDefined();
    expect(store.selectedNoteIds.has(pasted?.id ?? '')).toBe(true);
    expect(store.history.canUndo).toBe(true);
  });

  it('paste does nothing when clipboard is empty', () => {
    const store = createStore();
    store.paste(0);
    expect(store.notes.length).toBe(0);
    expect(store.history.canUndo).toBe(false);
  });

  it('duplicateSelection offsets by selection span and selects duplicates', () => {
    const store = createStore();
    store.addNote({ id: 'a', midiNote: 60, startBeat: 0, durationBeats: 2, velocity: 100 });
    store.addNote({ id: 'b', midiNote: 62, startBeat: 2, durationBeats: 2, velocity: 100 });
    store.selectAll();
    store.duplicateSelection();
    expect(store.notes.length).toBe(4);
    // Original span: 0..4, so duplicates start at 0+4=4 and 2+4=6
    const dup1 = store.notes.find((n) => n.startBeat === 4 && !['a', 'b'].includes(n.id));
    const dup2 = store.notes.find((n) => n.startBeat === 6 && !['a', 'b'].includes(n.id));
    expect(dup1).toBeDefined();
    expect(dup2).toBeDefined();
    expect(store.selectedNoteIds.has(dup1?.id ?? '')).toBe(true);
    expect(store.selectedNoteIds.has(dup2?.id ?? '')).toBe(true);
  });
});

// ── createStore — timeline event tracks (timeline.md, tracks.md) ────────────

describe('createStore — tempo track', () => {
  it('defaults to 122 BPM, backed by a single tempoTrack event at beat 0', () => {
    const store = createStore();
    expect(store.tempo).toBe(122);
    expect(store.tempoTrack).toHaveLength(1);
    expect(store.tempoTrack[0]).toMatchObject({ beat: 0, bpm: 122 });
  });

  it('setting tempo updates the underlying tempoTrack event in place', () => {
    const store = createStore();
    const originalId = store.tempoTrack[0].id;
    store.tempo = 140;
    expect(store.tempo).toBe(140);
    expect(store.tempoTrack).toHaveLength(1);
    expect(store.tempoTrack[0]).toEqual({ id: originalId, beat: 0, bpm: 140 });
  });
});

describe('createStore — time signature track', () => {
  it('defaults to a single 4/4 event at beat 0', () => {
    const store = createStore();
    expect(store.timeSignatureTrack).toHaveLength(1);
    expect(store.timeSignatureTrack[0]).toMatchObject({ beat: 0, numerator: 4, denominator: 4 });
  });

  it('barBeats produces bar lines every 4 beats by default', () => {
    const store = createStore();
    expect(store.totalBeats).toBe(64);
    expect(store.barBeats.slice(0, 4)).toEqual([0, 4, 8, 12]);
  });
});

describe('createStore — scale track', () => {
  it('defaults to a single C major event at beat 0', () => {
    const store = createStore();
    expect(store.scaleTrack).toHaveLength(1);
    expect(store.scaleTrack[0]).toMatchObject({ beat: 0, root: 0, mode: 'major' });
  });

  it('upsertScaleEvent adds a new marker and records history', () => {
    const store = createStore();
    store.upsertScaleEvent({ id: 'm1', beat: 8, root: 9, mode: 'aeolian' });
    expect(store.scaleTrack).toHaveLength(2);
    expect(store.scaleTrack[1]).toEqual({ id: 'm1', beat: 8, root: 9, mode: 'aeolian' });
    expect(store.history.canUndo).toBe(true);
  });

  it('upsertScaleEvent replaces an existing marker at the same beat instead of stacking', () => {
    const store = createStore();
    const defaultId = store.scaleTrack[0].id;
    store.upsertScaleEvent({ id: 'replacement', beat: 0, root: 7, mode: 'mixolydian' });
    expect(store.scaleTrack).toHaveLength(1);
    expect(store.scaleTrack[0]).toEqual({
      id: 'replacement',
      beat: 0,
      root: 7,
      mode: 'mixolydian',
    });
    expect(store.scaleTrack[0].id).not.toBe(defaultId);
  });

  it('removeScaleEvent removes the marker and records history', () => {
    const store = createStore();
    store.upsertScaleEvent({ id: 'm1', beat: 8, root: 9, mode: 'aeolian' });
    store.removeScaleEvent('m1');
    expect(store.scaleTrack.some((e) => e.id === 'm1')).toBe(false);
  });

  it('undo restores a removed scale marker', () => {
    const store = createStore();
    store.upsertScaleEvent({ id: 'm1', beat: 8, root: 9, mode: 'aeolian' });
    store.removeScaleEvent('m1');
    expect(store.scaleTrack.some((e) => e.id === 'm1')).toBe(false);
    store.undo();
    expect(store.scaleTrack.some((e) => e.id === 'm1')).toBe(true);
  });

  it('activeScaleAt resolves the scale in effect at a given beat', () => {
    const store = createStore();
    store.upsertScaleEvent({ id: 'm1', beat: 8, root: 9, mode: 'aeolian' });
    expect(store.activeScaleAt(0)?.mode).toBe('major');
    expect(store.activeScaleAt(7.9)?.mode).toBe('major');
    expect(store.activeScaleAt(8)?.mode).toBe('aeolian');
  });

  it('selectionContext.activeScales reflects the scale(s) under the current selection', () => {
    const store = createStore();
    store.addNote({ id: 'a', midiNote: 60, startBeat: 0, durationBeats: 2, velocity: 100 });
    store.selectNote('a', false);
    const ctx = store.selectionContext;
    expect(ctx.activeScales).toHaveLength(1);
    expect(ctx.activeScales[0].scale.mode).toBe('major');
    expect(ctx.activeScales[0].start).toBe(0);
    expect(ctx.activeScales[0].end).toBe(2);
  });

  it('selectionContext.activeScales splits a selection spanning a scale change into multiple segments', () => {
    const store = createStore();
    store.upsertScaleEvent({ id: 'm1', beat: 4, root: 9, mode: 'aeolian' });
    store.addNote({ id: 'a', midiNote: 60, startBeat: 0, durationBeats: 8, velocity: 100 });
    store.selectNote('a', false);
    const ctx = store.selectionContext;
    expect(ctx.activeScales).toHaveLength(2);
    expect(ctx.activeScales[0]).toMatchObject({ start: 0, end: 4 });
    expect(ctx.activeScales[1]).toMatchObject({ start: 4, end: 8 });
  });

  it('selectionContext.activeScales is empty when nothing is selected', () => {
    const store = createStore();
    expect(store.selectionContext.activeScales).toEqual([]);
  });
});

// ── createStore — undo/redo integration ──────────────────────────────────────

describe('createStore — undo/redo', () => {
  it('undo restores previous notes state', () => {
    const store = createStore();
    store.addNote({ id: 'a', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 });
    store.addNote({ id: 'b', midiNote: 62, startBeat: 1, durationBeats: 1, velocity: 100 });
    // selectNote 'b' then deleteSelected records history and removes it
    store.selectNote('b', false);
    store.deleteSelected();
    expect(store.notes.length).toBe(1);
    store.undo();
    // After undo, 'b' should be back
    expect(store.notes.length).toBe(2);
    expect(store.notes.some((n) => n.id === 'b')).toBe(true);
  });

  it('redo re-applies after undo', () => {
    const store = createStore();
    store.addNote({ id: 'a', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 });
    store.selectNote('a', false);
    store.deleteSelected(); // records and removes 'a'
    expect(store.notes.length).toBe(0);
    store.undo(); // restore 'a'
    expect(store.notes.length).toBe(1);
    store.redo(); // re-delete 'a'
    expect(store.notes.length).toBe(0);
  });
});
