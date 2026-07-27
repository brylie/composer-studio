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
    history.record('Test', () => ({ notes: [] }));
    expect(history.canUndo).toBe(true);
  });

  it('record() clears the redo stack', () => {
    history.record('A', () => ({ notes: [] }));
    history.undo(() => ({ notes: [] }));
    expect(history.canRedo).toBe(true);
    history.record('B', () => ({ notes: [] }));
    expect(history.canRedo).toBe(false);
  });

  it('undo() returns the recorded snapshot and sets canRedo=true', () => {
    const snap = {
      notes: [{ id: '1', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 }],
    };
    history.record('Transpose', () => snap);
    const entry = history.undo(() => ({ notes: [] }));
    expect(entry?.label).toBe('Transpose');
    expect(entry?.notes).toEqual(snap.notes);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
  });

  it('redo() returns the snapshot and restores canUndo', () => {
    history.record('Move', () => ({ notes: [] }));
    history.undo(() => ({ notes: [] }));
    const entry = history.redo(() => ({ notes: [] }));
    expect(entry?.label).toBe('Move');
    expect(history.canRedo).toBe(false);
    expect(history.canUndo).toBe(true);
  });

  it('undo() returns undefined when stack is empty', () => {
    expect(history.undo(() => ({ notes: [] }))).toBeUndefined();
  });

  it('redo() returns undefined when stack is empty', () => {
    expect(history.redo(() => ({ notes: [] }))).toBeUndefined();
  });

  it('trims undo stack to maxDepth (50)', () => {
    for (let i = 0; i < 55; i++) {
      history.record(`Step ${String(i)}`, () => ({ notes: [] }));
    }
    // pop 50 times — should all succeed
    for (let i = 0; i < 50; i++) {
      const entry = history.undo(() => ({ notes: [] }));
      expect(entry).toBeDefined();
    }
    // 51st pop must return undefined (stack was trimmed to 50)
    expect(history.undo(() => ({ notes: [] }))).toBeUndefined();
  });

  it('exposes undoLabel and redoLabel', () => {
    history.record('First', () => ({ notes: [] }));
    expect(history.undoLabel).toBe('First');
    history.undo(() => ({ notes: [] }));
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
