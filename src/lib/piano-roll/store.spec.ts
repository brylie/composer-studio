import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generatorCatalog } from './generators/catalog.js';
import { CommandHistory, isContiguous } from './history.js';
import { createStore } from './store.svelte.js';
import type { Note } from './types.js';
import {
  MAX_MIDI,
  MIN_DURATION_BEATS,
  MIN_MIDI,
  isBlackKey,
  midiToFreq,
  noteName,
} from './types.js';

/** Default-filled Note for tests that don't care about most fields — lands on `store`'s first layer unless overridden. */
function makeNote(
  store: ReturnType<typeof createStore>,
  overrides: Partial<Note> & { id: string },
): Note {
  return {
    midiNote: 60,
    startBeat: 0,
    durationBeats: 1,
    velocity: 100,
    layerId: store.layers[0].id,
    ...overrides,
  };
}

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
    const note = {
      id: '1',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 1,
      velocity: 100,
      layerId: 'l1',
    };
    expect(isContiguous([note])).toBe(true);
  });

  it('returns true for adjacent notes with no gap', () => {
    const notes = [
      { id: '1', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100, layerId: 'l1' },
      { id: '2', midiNote: 62, startBeat: 1, durationBeats: 1, velocity: 100, layerId: 'l1' },
    ];
    expect(isContiguous(notes)).toBe(true);
  });

  it('returns false when there is a gap between notes', () => {
    const notes = [
      { id: '1', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100, layerId: 'l1' },
      { id: '2', midiNote: 62, startBeat: 2, durationBeats: 1, velocity: 100, layerId: 'l1' }, // gap at beat 1
    ];
    expect(isContiguous(notes)).toBe(false);
  });

  it('returns true for overlapping notes', () => {
    const notes = [
      { id: '1', midiNote: 60, startBeat: 0, durationBeats: 2, velocity: 100, layerId: 'l1' },
      { id: '2', midiNote: 62, startBeat: 1, durationBeats: 2, velocity: 100, layerId: 'l1' },
    ];
    expect(isContiguous(notes)).toBe(true);
  });

  it('handles the covering-note edge case (union, not pairwise)', () => {
    // A 10-beat note at 0, a 2-beat note at 2 (nested), then a note starting at 10.
    // Naive pairwise: note[0].end=10, note[1].start=2 → gap reported (wrong).
    // Union-coverage: coveredUntil reaches 10, note at 10 is touching → no gap.
    const notes = [
      { id: '1', midiNote: 60, startBeat: 0, durationBeats: 10, velocity: 100, layerId: 'l1' },
      { id: '2', midiNote: 62, startBeat: 2, durationBeats: 2, velocity: 100, layerId: 'l1' },
      { id: '3', midiNote: 64, startBeat: 10, durationBeats: 1, velocity: 100, layerId: 'l1' },
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
    history.record('Test', () => ({
      notes: [],
      timeSignatureEvents: [],
      scaleEvents: [],
      chordEvents: [],
      labelEvents: [],
      arrangerSections: [],
      layers: [],
    }));
    expect(history.canUndo).toBe(true);
  });

  it('record() clears the redo stack', () => {
    history.record('A', () => ({
      notes: [],
      timeSignatureEvents: [],
      scaleEvents: [],
      chordEvents: [],
      labelEvents: [],
      arrangerSections: [],
      layers: [],
    }));
    history.undo(() => ({
      notes: [],
      timeSignatureEvents: [],
      scaleEvents: [],
      chordEvents: [],
      labelEvents: [],
      arrangerSections: [],
      layers: [],
    }));
    expect(history.canRedo).toBe(true);
    history.record('B', () => ({
      notes: [],
      timeSignatureEvents: [],
      scaleEvents: [],
      chordEvents: [],
      labelEvents: [],
      arrangerSections: [],
      layers: [],
    }));
    expect(history.canRedo).toBe(false);
  });

  it('undo() returns the recorded snapshot and sets canRedo=true', () => {
    const snap = {
      notes: [
        { id: '1', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100, layerId: 'l1' },
      ],
      timeSignatureEvents: [],
      scaleEvents: [],
      chordEvents: [],
      labelEvents: [],
      arrangerSections: [],
      layers: [],
    };
    history.record('Transpose', () => snap);
    const entry = history.undo(() => ({
      notes: [],
      timeSignatureEvents: [],
      scaleEvents: [],
      chordEvents: [],
      labelEvents: [],
      arrangerSections: [],
      layers: [],
    }));
    expect(entry?.label).toBe('Transpose');
    expect(entry?.notes).toEqual(snap.notes);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
  });

  it('redo() returns the snapshot and restores canUndo', () => {
    history.record('Move', () => ({
      notes: [],
      timeSignatureEvents: [],
      scaleEvents: [],
      chordEvents: [],
      labelEvents: [],
      arrangerSections: [],
      layers: [],
    }));
    history.undo(() => ({
      notes: [],
      timeSignatureEvents: [],
      scaleEvents: [],
      chordEvents: [],
      labelEvents: [],
      arrangerSections: [],
      layers: [],
    }));
    const entry = history.redo(() => ({
      notes: [],
      timeSignatureEvents: [],
      scaleEvents: [],
      chordEvents: [],
      labelEvents: [],
      arrangerSections: [],
      layers: [],
    }));
    expect(entry?.label).toBe('Move');
    expect(history.canRedo).toBe(false);
    expect(history.canUndo).toBe(true);
  });

  it('undo() returns undefined when stack is empty', () => {
    expect(
      history.undo(() => ({
        notes: [],
        timeSignatureEvents: [],
        scaleEvents: [],
        chordEvents: [],
        labelEvents: [],
        arrangerSections: [],
        layers: [],
      })),
    ).toBeUndefined();
  });

  it('redo() returns undefined when stack is empty', () => {
    expect(
      history.redo(() => ({
        notes: [],
        timeSignatureEvents: [],
        scaleEvents: [],
        chordEvents: [],
        labelEvents: [],
        arrangerSections: [],
        layers: [],
      })),
    ).toBeUndefined();
  });

  it('trims undo stack to maxDepth (50)', () => {
    for (let i = 0; i < 55; i++) {
      history.record(`Step ${String(i)}`, () => ({
        notes: [],
        timeSignatureEvents: [],
        scaleEvents: [],
        chordEvents: [],
        labelEvents: [],
        arrangerSections: [],
        layers: [],
      }));
    }
    // pop 50 times — should all succeed
    for (let i = 0; i < 50; i++) {
      const entry = history.undo(() => ({
        notes: [],
        timeSignatureEvents: [],
        scaleEvents: [],
        chordEvents: [],
        labelEvents: [],
        arrangerSections: [],
        layers: [],
      }));
      expect(entry).toBeDefined();
    }
    // 51st pop must return undefined (stack was trimmed to 50)
    expect(
      history.undo(() => ({
        notes: [],
        timeSignatureEvents: [],
        scaleEvents: [],
        chordEvents: [],
        labelEvents: [],
        arrangerSections: [],
        layers: [],
      })),
    ).toBeUndefined();
  });

  it('exposes undoLabel and redoLabel', () => {
    history.record('First', () => ({
      notes: [],
      timeSignatureEvents: [],
      scaleEvents: [],
      chordEvents: [],
      labelEvents: [],
      arrangerSections: [],
      layers: [],
    }));
    expect(history.undoLabel).toBe('First');
    history.undo(() => ({
      notes: [],
      timeSignatureEvents: [],
      scaleEvents: [],
      chordEvents: [],
      labelEvents: [],
      arrangerSections: [],
      layers: [],
    }));
    expect(history.redoLabel).toBe('First');
  });
});

// ── createStore — mutation invariants ────────────────────────────────────────

describe('createStore — mutation invariants', () => {
  it('clamps midiNote below MIN_MIDI on addNote', () => {
    const store = createStore();
    store.addNote(makeNote(store, { id: '1', midiNote: 0 }));
    expect(store.notes[0].midiNote).toBe(MIN_MIDI);
  });

  it('clamps midiNote above MAX_MIDI on addNote', () => {
    const store = createStore();
    store.addNote(makeNote(store, { id: '1', midiNote: 999 }));
    expect(store.notes[0].midiNote).toBe(MAX_MIDI);
  });

  it('clamps startBeat to >= 0 on addNote', () => {
    const store = createStore();
    store.addNote(makeNote(store, { id: '1', startBeat: -5 }));
    expect(store.notes[0].startBeat).toBe(0);
  });

  it('clamps durationBeats to >= MIN_DURATION_BEATS on addNote', () => {
    const store = createStore();
    store.addNote(makeNote(store, { id: '1', durationBeats: 0 }));
    expect(store.notes[0].durationBeats).toBe(MIN_DURATION_BEATS);
  });

  it('clamps velocity to [1, 127] on addNote', () => {
    const store = createStore();
    store.addNote(makeNote(store, { id: 'a', velocity: 0 }));
    store.addNote(makeNote(store, { id: 'b', velocity: 200 }));
    expect(store.notes[0].velocity).toBe(1);
    expect(store.notes[1].velocity).toBe(127);
  });

  it('clamps midiNote on updateNote', () => {
    const store = createStore();
    store.addNote(makeNote(store, { id: '1' }));
    store.updateNote('1', { midiNote: 200 });
    expect(store.notes[0].midiNote).toBe(MAX_MIDI);
  });

  it('auto-extends totalBeats when a note exceeds the current length', () => {
    const store = createStore();
    const initialBeats = store.totalBeats; // 64
    store.addNote(makeNote(store, { id: '1', startBeat: 60, durationBeats: 8 }));
    expect(store.totalBeats).toBeGreaterThan(initialBeats);
    // Should be rounded up to next 4-beat bar: ceil(68/4)*4 = 68
    expect(store.totalBeats % 4).toBe(0);
    expect(store.totalBeats).toBeGreaterThanOrEqual(68);
  });

  it('does not extend totalBeats when note fits', () => {
    const store = createStore();
    const initialBeats = store.totalBeats;
    store.addNote(makeNote(store, { id: '1' }));
    expect(store.totalBeats).toBe(initialBeats);
  });

  it('ignores duplicate note IDs', () => {
    const store = createStore();
    store.addNote(makeNote(store, { id: 'x' }));
    store.addNote(makeNote(store, { id: 'x', midiNote: 62, startBeat: 1 }));
    expect(store.notes.length).toBe(1);
  });
});

// ── createStore — SvelteSet selection ────────────────────────────────────────

describe('createStore — selection', () => {
  it('selectNote exclusive: clears others', () => {
    const store = createStore();
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });
    store.addNote({
      id: 'b',
      midiNote: 62,
      startBeat: 1,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });
    store.selectNote('a', false);
    store.selectNote('b', false);
    expect(store.selectedNoteIds.has('a')).toBe(false);
    expect(store.selectedNoteIds.has('b')).toBe(true);
    expect(store.selectedNoteIds.size).toBe(1);
  });

  it('selectNote toggle: adds when absent', () => {
    const store = createStore();
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });
    store.selectNote('a', true);
    expect(store.selectedNoteIds.has('a')).toBe(true);
  });

  it('selectNote toggle: removes when present', () => {
    const store = createStore();
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });
    store.selectNote('a', true);
    store.selectNote('a', true);
    expect(store.selectedNoteIds.has('a')).toBe(false);
  });

  it('selectAll selects every note', () => {
    const store = createStore();
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });
    store.addNote({
      id: 'b',
      midiNote: 62,
      startBeat: 1,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });
    store.selectAll();
    expect(store.selectedNoteIds.size).toBe(2);
  });

  it('deselectAll clears selection and anchor', () => {
    const store = createStore();
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });
    store.selectNote('a', false);
    store.setAnchor('a');
    store.deselectAll();
    expect(store.selectedNoteIds.size).toBe(0);
    expect(store.selectionAnchor).toBeNull();
  });

  it('selectNotes replaces when addToSelection=false', () => {
    const store = createStore();
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });
    store.addNote({
      id: 'b',
      midiNote: 62,
      startBeat: 1,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });
    store.selectNote('a', false);
    store.selectNotes(['b'], false);
    expect(store.selectedNoteIds.has('a')).toBe(false);
    expect(store.selectedNoteIds.has('b')).toBe(true);
  });

  it('selectNotes adds when addToSelection=true', () => {
    const store = createStore();
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });
    store.addNote({
      id: 'b',
      midiNote: 62,
      startBeat: 1,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });
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
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });
    store.selectRange('a');
    expect(store.selectedNoteIds.has('a')).toBe(true);
    expect(store.selectedNoteIds.size).toBe(1);
  });

  it('selectRange selects inclusive range between anchor and focus', () => {
    const store = createStore();
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });
    store.addNote({
      id: 'b',
      midiNote: 62,
      startBeat: 1,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });
    store.addNote({
      id: 'c',
      midiNote: 64,
      startBeat: 2,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });
    store.setAnchor('a');
    store.selectRange('c');
    expect(store.selectedNoteIds.size).toBe(3);
    expect(store.selectedNoteIds.has('a')).toBe(true);
    expect(store.selectedNoteIds.has('b')).toBe(true);
    expect(store.selectedNoteIds.has('c')).toBe(true);
  });

  it('removeNote removes the note from selection', () => {
    const store = createStore();
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });
    store.selectNote('a', false);
    store.removeNote('a');
    expect(store.selectedNoteIds.has('a')).toBe(false);
  });

  it('deleteSelected removes selected notes and records history', () => {
    const store = createStore();
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });
    store.addNote({
      id: 'b',
      midiNote: 62,
      startBeat: 1,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });
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
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 1,
      durationBeats: 2,
      velocity: 100,
      layerId: store.layers[0].id,
    });
    store.addNote({
      id: 'b',
      midiNote: 72,
      startBeat: 3,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });
    store.selectAll();
    const ctx = store.selectionContext;
    expect(ctx.pitchRange).toEqual({ min: 60, max: 72 });
    expect(ctx.beatRange).toEqual({ start: 1, end: 4 });
  });

  it('isContiguous is false when selected notes have a gap', () => {
    const store = createStore();
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });
    store.addNote({
      id: 'b',
      midiNote: 62,
      startBeat: 3,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    }); // gap
    store.selectAll();
    expect(store.selectionContext.isContiguous).toBe(false);
  });
});

// ── createStore — commandContext ──────────────────────────────────────────────

describe('createStore — commandContext', () => {
  it('extends selectionContext with allNotes, playhead, and chordTrack (empty until a chord marker is added)', () => {
    const store = createStore();
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });
    store.addNote({
      id: 'b',
      midiNote: 64,
      startBeat: 1,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });
    store.selectNote('a', false);

    const ctx = store.commandContext;
    expect(ctx.allNotes).toHaveLength(2);
    expect(ctx.playhead).toBe(store.currentBeat);
    expect(ctx.chordTrack).toEqual([]);
    expect(ctx.activeLayerId).toBe(store.activeLayerId);
    // still carries the selection-derived fields
    expect(ctx.count).toBe(1);
    expect(ctx.notes[0].id).toBe('a');
  });
});

// ── createStore — executeCommand ───────────────────────────────────────────

describe('createStore — executeCommand', () => {
  it('runs a registry command with params and records history', () => {
    const store = createStore();
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });
    store.selectNote('a', false);

    const executed = store.executeCommand('transpose', { semitones: 5 });

    expect(executed).toBe(true);
    expect(store.notes[0].midiNote).toBe(65);
    expect(store.history.canUndo).toBe(true);
    expect(store.history.undoLabel).toBe('Transpose +5');
  });

  it('returns false and leaves notes/history untouched for an unknown command', () => {
    const store = createStore();
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });
    store.selectNote('a', false);

    const executed = store.executeCommand('not-a-real-command', { semitones: 5 });

    expect(executed).toBe(false);
    expect(store.notes[0].midiNote).toBe(60);
    expect(store.history.canUndo).toBe(false);
  });

  it('returns false and leaves notes/history untouched for an inapplicable command', () => {
    const store = createStore();
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });
    // No selection, so transpose (requires selectAtLeastOne) is inapplicable.

    const executed = store.executeCommand('transpose', { semitones: 5 });

    expect(executed).toBe(false);
    expect(store.notes[0].midiNote).toBe(60);
    expect(store.history.canUndo).toBe(false);
  });
});

// ── createStore — quickApplyCommand (direct-manipulation.md) ────────────────

describe('createStore — quickApplyCommand', () => {
  it('runs immediately using each param field default, without a params object from the caller', () => {
    const store = createStore();
    store.addNote(makeNote(store, { id: 'a', midiNote: 60 }));
    store.selectNote('a', false);

    const applied = store.quickApplyCommand('transpose');

    expect(applied).toBe(true);
    // transpose's `semitones` field defaults to 1 (transpose.ts) — quick-apply
    // must fill that in itself rather than calling run() with an empty params bag.
    expect(store.notes[0].midiNote).toBe(61);
    expect(store.history.canUndo).toBe(true);
  });

  it('returns false and leaves notes/history untouched for an inapplicable command', () => {
    const store = createStore();
    store.addNote(makeNote(store, { id: 'a', midiNote: 60 }));
    // No selection — transpose requires at least one selected note.

    const applied = store.quickApplyCommand('transpose');

    expect(applied).toBe(false);
    expect(store.notes[0].midiNote).toBe(60);
    expect(store.history.canUndo).toBe(false);
  });

  it('returns false for an unknown command id', () => {
    const store = createStore();
    expect(store.quickApplyCommand('not-a-real-command')).toBe(false);
  });
});

// ── createStore — quickApplyGenerator (direct-manipulation.md) ──────────────

describe('createStore — quickApplyGenerator', () => {
  it("derives bounds from the selection's own extent and commits immediately, no session left behind", () => {
    const store = createStore();
    store.addNote(makeNote(store, { id: 'a', midiNote: 60, startBeat: 0, durationBeats: 4 }));
    store.selectNote('a', false);

    const applied = store.quickApplyGenerator('euclidean-rhythm');

    expect(applied).toBe(true);
    expect(store.generatorSession).toBeNull();
    expect(store.history.canUndo).toBe(true);

    const generated = store.notes.filter((n) => n.id !== 'a');
    expect(generated.length).toBeGreaterThan(0);
    for (const note of generated) {
      // The selection was a single note at midiNote 60 spanning beats
      // [0, 4) — quick-apply's bounds should come from exactly that extent
      // (direct-manipulation.md's "selection rectangle is the bounds
      // field"), not the generator's own playhead-relative default bounds.
      expect(note.midiNote).toBe(60);
      expect(note.startBeat).toBeGreaterThanOrEqual(0);
      expect(note.startBeat).toBeLessThan(4);
    }
  });

  it('refuses while a generator session is already active', () => {
    const store = createStore();
    store.addNote(makeNote(store, { id: 'a', midiNote: 60, startBeat: 0, durationBeats: 4 }));
    store.selectNote('a', false);
    const pulsePattern = generatorCatalog.find((g) => g.id === 'pulse-pattern');
    if (!pulsePattern) throw new Error('pulse-pattern missing from generatorCatalog');
    const started = store.startGeneratorSessionFromDescriptor(pulsePattern, 'Pulse');
    expect(started).toBe(true);

    const applied = store.quickApplyGenerator('euclidean-rhythm');

    expect(applied).toBe(false);
    expect(store.generatorSession).not.toBeNull();
  });

  it('returns false for an unknown generator id', () => {
    const store = createStore();
    expect(store.quickApplyGenerator('not-a-real-generator')).toBe(false);
  });

  it('returns false and leaves notes/history untouched when evaluation produces an error diagnostic', () => {
    const store = createStore();
    store.addNote(makeNote(store, { id: 'a', midiNote: 60, startBeat: 0, durationBeats: 4 }));
    store.selectNote('a', false);
    const euclidean = generatorCatalog.find((g) => g.id === 'euclidean-rhythm');
    if (!euclidean) throw new Error('euclidean-rhythm missing from generatorCatalog');
    // An output referencing a node id that doesn't exist in the recipe fails
    // validateRecipe (recipe.ts's 'unknown-output-node'), forcing
    // evaluateSession's outcome.session.status to 'error' regardless of what
    // the registered operators can otherwise produce.
    const spy = vi.spyOn(euclidean, 'createDefaultRecipe').mockReturnValue({
      id: 'broken-recipe',
      version: 1,
      nodes: [],
      edges: [],
      output: { nodeId: 'missing-node', port: 'notes' },
    });

    const applied = store.quickApplyGenerator('euclidean-rhythm');

    expect(applied).toBe(false);
    expect(store.notes.length).toBe(1);
    expect(store.notes[0].id).toBe('a');
    expect(store.history.canUndo).toBe(false);
    expect(store.generatorDiagnostics.some((d) => d.level === 'error')).toBe(true);

    spy.mockRestore();
  });
});

// ── createStore — applyCommandResult ──────────────────────────────────────────

describe('createStore — applyCommandResult', () => {
  it('replaces the notes array with the (clamped) command result', () => {
    const store = createStore();
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });

    store.applyCommandResult({
      notes: [
        {
          id: 'a',
          midiNote: 999,
          startBeat: -5,
          durationBeats: 0,
          velocity: 200,
          layerId: store.layers[0].id,
        },
      ],
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
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });

    store.applyCommandResult({
      notes: [
        {
          id: 'a',
          midiNote: 65,
          startBeat: 0,
          durationBeats: 1,
          velocity: 100,
          layerId: store.layers[0].id,
        },
      ],
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
      notes: [
        {
          id: 'a',
          midiNote: 60,
          startBeat: 60,
          durationBeats: 8,
          velocity: 100,
          layerId: store.layers[0].id,
        },
      ],
      label: 'Grow',
    });
    expect(store.totalBeats).toBeGreaterThan(initialBeats);
  });

  it('prunes selection to only notes that still exist after the command result', () => {
    const store = createStore();
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });
    store.addNote({
      id: 'b',
      midiNote: 62,
      startBeat: 1,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });
    store.selectAll();
    expect(store.selectionContext.count).toBe(2);

    store.applyCommandResult({
      notes: [
        {
          id: 'a',
          midiNote: 60,
          startBeat: 0,
          durationBeats: 1,
          velocity: 100,
          layerId: store.layers[0].id,
        },
      ],
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
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 4,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });
    store.addNote({
      id: 'b',
      midiNote: 62,
      startBeat: 5,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });
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
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });
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
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 2,
      velocity: 100,
      layerId: store.layers[0].id,
    });
    store.addNote({
      id: 'b',
      midiNote: 62,
      startBeat: 2,
      durationBeats: 2,
      velocity: 100,
      layerId: store.layers[0].id,
    });
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

  it('beatGroupLines produces 3 internal ticks per bar by default (4/4 fallback)', () => {
    const store = createStore();
    expect(store.beatGroupLines.slice(0, 3)).toEqual([1, 2, 3]);
  });

  it('regression: a mid-bar time signature change never produces duplicate beatGroupLines values', () => {
    // Reproduces the crash a mid-bar marker used to trigger: adding a 3/4
    // marker at beat 1 truncates the preceding 4/4 bar to [0, 1) per
    // barBeats, but beatGroupLinePositions used to compute that truncated
    // bar's ticks as if it were still a full 4-beat bar — producing beats
    // (2, 3) that collided with the new bar's own ticks. Duplicate values
    // fed into the note grid's keyed `{#each}` crash Svelte
    // (each_key_duplicate); a plain Set-size check catches the regression
    // without needing a rendered component.
    const store = createStore();
    store.upsertTimeSignatureEvent({ id: 'm1', beat: 1, numerator: 3, denominator: 4 });
    const ticks = store.beatGroupLines;
    expect(new Set(ticks).size).toBe(ticks.length);
  });

  it('upsertTimeSignatureEvent adds a new marker and records history', () => {
    const store = createStore();
    store.upsertTimeSignatureEvent({ id: 'm1', beat: 8, numerator: 3, denominator: 4 });
    expect(store.timeSignatureTrack).toHaveLength(2);
    expect(store.timeSignatureTrack[1]).toEqual({
      id: 'm1',
      beat: 8,
      numerator: 3,
      denominator: 4,
    });
    expect(store.history.canUndo).toBe(true);
  });

  it('upsertTimeSignatureEvent replaces an existing marker at the same beat instead of stacking', () => {
    const store = createStore();
    const defaultId = store.timeSignatureTrack[0].id;
    store.upsertTimeSignatureEvent({ id: 'replacement', beat: 0, numerator: 3, denominator: 4 });
    expect(store.timeSignatureTrack).toHaveLength(1);
    expect(store.timeSignatureTrack[0]).toEqual({
      id: 'replacement',
      beat: 0,
      numerator: 3,
      denominator: 4,
    });
    expect(store.timeSignatureTrack[0].id).not.toBe(defaultId);
  });

  it('changing bar length via upsertTimeSignatureEvent is reflected in barBeats', () => {
    const store = createStore();
    store.upsertTimeSignatureEvent({ id: 'replacement', beat: 0, numerator: 3, denominator: 4 });
    expect(store.barBeats.slice(0, 4)).toEqual([0, 3, 6, 9]);
  });

  it('removeTimeSignatureEvent removes a non-beat-0 marker and records history', () => {
    const store = createStore();
    store.upsertTimeSignatureEvent({ id: 'm1', beat: 8, numerator: 3, denominator: 4 });
    store.removeTimeSignatureEvent('m1');
    expect(store.timeSignatureTrack.some((e) => e.id === 'm1')).toBe(false);
  });

  it('undo restores a removed time signature marker', () => {
    const store = createStore();
    store.upsertTimeSignatureEvent({ id: 'm1', beat: 8, numerator: 3, denominator: 4 });
    store.removeTimeSignatureEvent('m1');
    store.undo();
    expect(store.timeSignatureTrack.some((e) => e.id === 'm1')).toBe(true);
  });

  it('removeTimeSignatureEvent is a no-op for the marker at beat 0 — a project can never have zero time signature', () => {
    const store = createStore();
    const defaultId = store.timeSignatureTrack[0].id;
    store.removeTimeSignatureEvent(defaultId);
    expect(store.timeSignatureTrack).toHaveLength(1);
    expect(store.timeSignatureTrack[0].id).toBe(defaultId);
    expect(store.history.canUndo).toBe(false);
  });

  it('moveTimeSignatureEvent relocates a non-beat-0 marker to a new beat', () => {
    const store = createStore();
    store.upsertTimeSignatureEvent({ id: 'm1', beat: 8, numerator: 3, denominator: 4 });
    store.moveTimeSignatureEvent('m1', 12);
    expect(store.timeSignatureTrack.find((e) => e.id === 'm1')).toEqual({
      id: 'm1',
      beat: 12,
      numerator: 3,
      denominator: 4,
    });
  });

  it('moveTimeSignatureEvent is a no-op when moving the beat-0 marker away from beat 0', () => {
    const store = createStore();
    const defaultId = store.timeSignatureTrack[0].id;
    store.moveTimeSignatureEvent(defaultId, 8);
    expect(store.timeSignatureTrack).toHaveLength(1);
    expect(store.timeSignatureTrack[0].beat).toBe(0);
    expect(store.history.canUndo).toBe(false);
  });

  it('moveTimeSignatureEvent allows a different marker to move onto beat 0, replacing it', () => {
    const store = createStore();
    store.upsertTimeSignatureEvent({ id: 'm1', beat: 8, numerator: 3, denominator: 4 });
    store.moveTimeSignatureEvent('m1', 0);
    expect(store.timeSignatureTrack).toHaveLength(1);
    expect(store.timeSignatureTrack[0]).toEqual({
      id: 'm1',
      beat: 0,
      numerator: 3,
      denominator: 4,
    });
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

  it('moveScaleEvent relocates a marker to a new beat, keeping its id/root/mode', () => {
    const store = createStore();
    store.upsertScaleEvent({ id: 'm1', beat: 8, root: 9, mode: 'aeolian' });
    store.moveScaleEvent('m1', 12);
    expect(store.scaleTrack.find((e) => e.id === 'm1')).toEqual({
      id: 'm1',
      beat: 12,
      root: 9,
      mode: 'aeolian',
    });
    expect(store.scaleTrack).toHaveLength(2);
  });

  it('moveScaleEvent replaces whatever marker already occupies the target beat', () => {
    const store = createStore();
    store.upsertScaleEvent({ id: 'm1', beat: 8, root: 9, mode: 'aeolian' });
    store.upsertScaleEvent({ id: 'm2', beat: 16, root: 2, mode: 'dorian' });
    store.moveScaleEvent('m1', 16);
    expect(store.scaleTrack).toHaveLength(2); // default C-major event + the moved m1
    expect(store.scaleTrack.some((e) => e.id === 'm2')).toBe(false);
    expect(store.scaleTrack.find((e) => e.beat === 16)).toEqual({
      id: 'm1',
      beat: 16,
      root: 9,
      mode: 'aeolian',
    });
  });

  it('moveScaleEvent records history so undo restores the original beat', () => {
    const store = createStore();
    store.upsertScaleEvent({ id: 'm1', beat: 8, root: 9, mode: 'aeolian' });
    store.moveScaleEvent('m1', 12);
    expect(store.history.undoLabel).toBe('Move scale marker');
    store.undo();
    expect(store.scaleTrack.find((e) => e.id === 'm1')?.beat).toBe(8);
  });

  it('moveScaleEvent is a no-op (no history entry) when the beat is unchanged', () => {
    const store = createStore();
    store.upsertScaleEvent({ id: 'm1', beat: 8, root: 9, mode: 'aeolian' });
    const undoLabelBefore = store.history.undoLabel;
    store.moveScaleEvent('m1', 8);
    expect(store.history.undoLabel).toBe(undoLabelBefore);
  });

  it('moveScaleEvent is a no-op for an unknown id', () => {
    const store = createStore();
    store.moveScaleEvent('does-not-exist', 8);
    expect(store.scaleTrack).toHaveLength(1);
    expect(store.history.canUndo).toBe(false);
  });

  it('moveScaleEvent is a no-op (no history entry) when a negative beat clamps back to the current beat', () => {
    const store = createStore();
    // Default marker is already at beat 0 — moving to a negative beat clamps
    // to 0, which must be recognized as unchanged, not recorded as a move.
    store.moveScaleEvent(store.scaleTrack[0].id, -5);
    expect(store.scaleTrack[0].beat).toBe(0);
    expect(store.history.canUndo).toBe(false);
  });

  it('moveScaleEvent clamps a negative beat to 0 when it does change the position', () => {
    const store = createStore();
    store.upsertScaleEvent({ id: 'm1', beat: 8, root: 9, mode: 'aeolian' });
    store.moveScaleEvent('m1', -5);
    expect(store.scaleTrack.find((e) => e.id === 'm1')?.beat).toBe(0);
    expect(store.history.undoLabel).toBe('Move scale marker');
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
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 2,
      velocity: 100,
      layerId: store.layers[0].id,
    });
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
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 8,
      velocity: 100,
      layerId: store.layers[0].id,
    });
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

describe('createStore — chord track', () => {
  it('starts empty — unlike the scale track, there is no sensible default chord', () => {
    const store = createStore();
    expect(store.chordTrack).toEqual([]);
  });

  it('upsertChordEvent adds a new marker and records history', () => {
    const store = createStore();
    store.upsertChordEvent({ id: 'c1', beat: 0, root: 0, quality: 'maj7' });
    expect(store.chordTrack).toHaveLength(1);
    expect(store.chordTrack[0]).toEqual({ id: 'c1', beat: 0, root: 0, quality: 'maj7' });
    expect(store.history.undoLabel).toBe('Set chord marker');
  });

  it('upsertChordEvent replaces an existing marker at the same beat instead of stacking', () => {
    const store = createStore();
    store.upsertChordEvent({ id: 'c1', beat: 0, root: 0, quality: 'maj' });
    store.upsertChordEvent({ id: 'replacement', beat: 0, root: 7, quality: '7' });
    expect(store.chordTrack).toHaveLength(1);
    expect(store.chordTrack[0]).toEqual({ id: 'replacement', beat: 0, root: 7, quality: '7' });
  });

  it('removeChordEvent removes the marker and records history', () => {
    const store = createStore();
    store.upsertChordEvent({ id: 'c1', beat: 0, root: 0, quality: 'maj7' });
    store.removeChordEvent('c1');
    expect(store.chordTrack).toEqual([]);
    expect(store.history.undoLabel).toBe('Remove chord marker');
  });

  it('undo restores a removed chord marker', () => {
    const store = createStore();
    store.upsertChordEvent({ id: 'c1', beat: 0, root: 0, quality: 'maj7' });
    store.removeChordEvent('c1');
    store.undo();
    expect(store.chordTrack.some((e) => e.id === 'c1')).toBe(true);
  });

  it('moveChordEvent relocates a marker to a new beat, keeping its id/root/quality', () => {
    const store = createStore();
    store.upsertChordEvent({ id: 'c1', beat: 0, root: 0, quality: 'maj7' });
    store.moveChordEvent('c1', 4);
    expect(store.chordTrack[0]).toEqual({ id: 'c1', beat: 4, root: 0, quality: 'maj7' });
    expect(store.history.undoLabel).toBe('Move chord marker');
  });

  it('moveChordEvent is a no-op (no history entry) when the beat is unchanged', () => {
    const store = createStore();
    store.upsertChordEvent({ id: 'c1', beat: 0, root: 0, quality: 'maj7' });
    const undoLabelBefore = store.history.undoLabel;
    store.moveChordEvent('c1', 0);
    expect(store.history.undoLabel).toBe(undoLabelBefore);
  });

  it('moveChordEvent is a no-op for an unknown id', () => {
    const store = createStore();
    store.moveChordEvent('does-not-exist', 4);
    expect(store.chordTrack).toEqual([]);
    expect(store.history.canUndo).toBe(false);
  });

  it('activeChordAt resolves the chord in effect at a given beat', () => {
    const store = createStore();
    store.upsertChordEvent({ id: 'c1', beat: 0, root: 0, quality: 'maj7' });
    store.upsertChordEvent({ id: 'c2', beat: 8, root: 7, quality: '7' });
    expect(store.activeChordAt(0)?.quality).toBe('maj7');
    expect(store.activeChordAt(7.9)?.quality).toBe('maj7');
    expect(store.activeChordAt(8)?.quality).toBe('7');
  });

  it('commandContext.chordTrack reflects the real chord track, not a stub', () => {
    const store = createStore();
    store.upsertChordEvent({ id: 'c1', beat: 0, root: 0, quality: 'maj7' });
    expect(store.commandContext.chordTrack).toEqual([
      { id: 'c1', beat: 0, root: 0, quality: 'maj7' },
    ]);
  });
});

describe('createStore — label track', () => {
  it('starts empty', () => {
    const store = createStore();
    expect(store.labelTrack).toEqual([]);
  });

  it('upsertLabelEvent adds a new marker and records history', () => {
    const store = createStore();
    store.upsertLabelEvent({ id: 'l1', beat: 4, text: 'Solo starts here' });
    expect(store.labelTrack).toHaveLength(1);
    expect(store.labelTrack[0]).toEqual({ id: 'l1', beat: 4, text: 'Solo starts here' });
    expect(store.history.undoLabel).toBe('Set label marker');
  });

  it('upsertLabelEvent replaces an existing marker at the same beat instead of stacking', () => {
    const store = createStore();
    store.upsertLabelEvent({ id: 'l1', beat: 4, text: 'Verse 2' });
    store.upsertLabelEvent({ id: 'replacement', beat: 4, text: 'Chorus' });
    expect(store.labelTrack).toHaveLength(1);
    expect(store.labelTrack[0]).toEqual({ id: 'replacement', beat: 4, text: 'Chorus' });
  });

  it('removeLabelEvent removes the marker and records history', () => {
    const store = createStore();
    store.upsertLabelEvent({ id: 'l1', beat: 4, text: 'Solo starts here' });
    store.removeLabelEvent('l1');
    expect(store.labelTrack).toEqual([]);
    expect(store.history.undoLabel).toBe('Remove label marker');
  });

  it('undo restores a removed label marker', () => {
    const store = createStore();
    store.upsertLabelEvent({ id: 'l1', beat: 4, text: 'Solo starts here' });
    store.removeLabelEvent('l1');
    store.undo();
    expect(store.labelTrack.some((e) => e.id === 'l1')).toBe(true);
  });

  it('moveLabelEvent relocates a marker to a new beat, keeping its id/text', () => {
    const store = createStore();
    store.upsertLabelEvent({ id: 'l1', beat: 4, text: 'Solo starts here' });
    store.moveLabelEvent('l1', 8);
    expect(store.labelTrack[0]).toEqual({ id: 'l1', beat: 8, text: 'Solo starts here' });
    expect(store.history.undoLabel).toBe('Move label marker');
  });
});

// ── createStore — arranger track (tracks.md#arranger-track-placeholder) ──────

describe('createStore — arranger track', () => {
  it('starts empty', () => {
    const store = createStore();
    expect(store.arrangerTrack).toEqual([]);
  });

  it('addArrangerSection adds a default-sized section and records history', () => {
    const store = createStore();
    store.addArrangerSection(4);
    expect(store.arrangerTrack).toHaveLength(1);
    expect(store.arrangerTrack[0]).toMatchObject({
      label: 'New section',
      startBeat: 4,
      endBeat: 8,
    });
    expect(store.history.undoLabel).toBe('Add section');
  });

  it('addArrangerSection is a no-op when tapped inside an existing section', () => {
    const store = createStore();
    store.addArrangerSection(0);
    const before = store.arrangerTrack;
    store.addArrangerSection(2);
    expect(store.arrangerTrack).toBe(before);
    expect(store.arrangerTrack).toHaveLength(1);
  });

  it('moveArrangerSection relocates a section, keeping its duration, and records history', () => {
    const store = createStore();
    store.addArrangerSection(0);
    const id = store.arrangerTrack[0].id;
    store.moveArrangerSection(id, 10);
    expect(store.arrangerTrack[0]).toMatchObject({ startBeat: 10, endBeat: 14 });
    expect(store.history.undoLabel).toBe('Move section');
  });

  it('moveArrangerSection clamps against a neighboring section instead of overlapping it', () => {
    const store = createStore();
    store.addArrangerSection(0); // [0, 4)
    store.addArrangerSection(10); // [10, 14)
    const [first, second] = store.arrangerTrack;
    store.moveArrangerSection(second.id, 1); // drag toward `first`
    const moved = store.arrangerTrack.find((s) => s.id === second.id);
    expect(moved?.startBeat).toBe(first.endBeat);
  });

  it('resizeArrangerSectionStart/End adjust edges and record history', () => {
    const store = createStore();
    store.addArrangerSection(0); // [0, 4)
    const id = store.arrangerTrack[0].id;
    store.resizeArrangerSectionStart(id, 1);
    expect(store.arrangerTrack[0]).toMatchObject({ startBeat: 1, endBeat: 4 });
    expect(store.history.undoLabel).toBe('Resize section');
    store.resizeArrangerSectionEnd(id, 8);
    expect(store.arrangerTrack[0]).toMatchObject({ startBeat: 1, endBeat: 8 });
    expect(store.history.undoLabel).toBe('Resize section');
  });

  it('updateArrangerSection renames/recolors a section without moving it', () => {
    const store = createStore();
    store.addArrangerSection(0);
    const id = store.arrangerTrack[0].id;
    store.updateArrangerSection(id, { label: 'Chorus', color: '#123456' });
    expect(store.arrangerTrack[0]).toMatchObject({
      label: 'Chorus',
      color: '#123456',
      startBeat: 0,
      endBeat: 4,
    });
    expect(store.history.undoLabel).toBe('Rename section');
  });

  it('removeArrangerSection removes the section and records history', () => {
    const store = createStore();
    store.addArrangerSection(0);
    const id = store.arrangerTrack[0].id;
    store.removeArrangerSection(id);
    expect(store.arrangerTrack).toEqual([]);
    expect(store.history.undoLabel).toBe('Remove section');
  });

  it('undo restores a removed section', () => {
    const store = createStore();
    store.addArrangerSection(0);
    const id = store.arrangerTrack[0].id;
    store.removeArrangerSection(id);
    store.undo();
    expect(store.arrangerTrack.some((s) => s.id === id)).toBe(true);
  });
});

// ── createStore — layers (layers.md) ──────────────────────────────────────────

describe('createStore — layers', () => {
  it('starts with exactly one default "Piano" layer, active', () => {
    const store = createStore();
    expect(store.layers).toHaveLength(1);
    expect(store.layers[0].name).toBe('Piano');
    expect(store.activeLayerId).toBe(store.layers[0].id);
  });

  it('addLayer prepends a new layer and makes it active', () => {
    const store = createStore();
    const originalId = store.layers[0].id;
    store.addLayer();
    expect(store.layers).toHaveLength(2);
    expect(store.layers[0].id).not.toBe(originalId);
    expect(store.activeLayerId).toBe(store.layers[0].id);
    expect(store.layers[1].id).toBe(originalId);
  });

  it('addLayer is undoable', () => {
    const store = createStore();
    store.addLayer();
    store.undo();
    expect(store.layers).toHaveLength(1);
  });

  it('renameLayer updates the name and is undoable', () => {
    const store = createStore();
    const id = store.layers[0].id;
    store.renameLayer(id, 'Strings');
    expect(store.layerFor(id)?.name).toBe('Strings');
    store.undo();
    expect(store.layerFor(id)?.name).toBe('Piano');
  });

  it('renameLayer no-ops (no history entry) when the name is unchanged', () => {
    const store = createStore();
    const id = store.layers[0].id;
    store.renameLayer(id, 'Piano');
    expect(store.history.canUndo).toBe(false);
  });

  it('setLayerVisible toggles visibility and is undoable', () => {
    const store = createStore();
    const id = store.layers[0].id;
    store.setLayerVisible(id, false);
    expect(store.layerFor(id)?.visible).toBe(false);
    store.undo();
    expect(store.layerFor(id)?.visible).toBe(true);
  });

  it('setLayerLocked toggles lock and is undoable', () => {
    const store = createStore();
    const id = store.layers[0].id;
    store.setLayerLocked(id, true);
    expect(store.layerFor(id)?.locked).toBe(true);
    store.undo();
    expect(store.layerFor(id)?.locked).toBe(false);
  });

  it('moveLayer reorders the stack and is undoable', () => {
    const store = createStore();
    const firstId = store.layers[0].id;
    store.addLayer();
    const secondId = store.layers[0].id; // addLayer prepends, so this is the new one
    store.moveLayer(secondId, 1);
    expect(store.layers.map((l) => l.id)).toEqual([firstId, secondId]);
    store.undo();
    expect(store.layers.map((l) => l.id)).toEqual([secondId, firstId]);
  });

  it('removeLayer refuses to remove the only remaining layer', () => {
    const store = createStore();
    const id = store.layers[0].id;
    store.removeLayer(id);
    expect(store.layers).toHaveLength(1);
    expect(store.history.canUndo).toBe(false);
  });

  it('removeLayer deletes the layer and every note on it, in one undo step', () => {
    const store = createStore();
    const firstId = store.layers[0].id;
    store.addLayer();
    const secondId = store.layers[0].id;
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 1,
      velocity: 100,
      layerId: secondId,
    });
    store.addNote({
      id: 'b',
      midiNote: 62,
      startBeat: 1,
      durationBeats: 1,
      velocity: 100,
      layerId: firstId,
    });

    store.removeLayer(secondId);
    expect(store.layers).toHaveLength(1);
    expect(store.notes.map((n) => n.id)).toEqual(['b']);

    store.undo();
    expect(store.layers).toHaveLength(2);
    expect(store.notes.map((n) => n.id).sort()).toEqual(['a', 'b']);
  });

  it('removeLayer reassigns activeLayerId when the active layer is removed', () => {
    const store = createStore();
    const firstId = store.layers[0].id;
    store.addLayer();
    const secondId = store.layers[0].id;
    expect(store.activeLayerId).toBe(secondId);
    store.removeLayer(secondId);
    expect(store.activeLayerId).toBe(firstId);
  });

  it('removeLayer prunes selection to notes that still exist', () => {
    const store = createStore();
    store.addLayer();
    const secondId = store.layers[0].id;
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 1,
      velocity: 100,
      layerId: secondId,
    });
    store.selectNote('a', false);
    store.removeLayer(secondId);
    expect(store.selectedNoteIds.has('a')).toBe(false);
  });

  it('new notes drawn via addNote land on whatever layer is passed (activeLayerId at the UI call site)', () => {
    const store = createStore();
    store.addLayer();
    const activeId = store.activeLayerId;
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 1,
      velocity: 100,
      layerId: store.activeLayerId,
    });
    expect(store.notes[0].layerId).toBe(activeId);
  });

  it('selectionContext drops a note reactively when its layer is hidden, without touching selectedNoteIds', () => {
    const store = createStore();
    const layerId = store.layers[0].id;
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 1,
      velocity: 100,
      layerId,
    });
    store.selectNote('a', false);
    expect(store.selectionContext.count).toBe(1);

    store.setLayerVisible(layerId, false);
    expect(store.selectionContext.count).toBe(0);
    expect(store.selectionContext.activeLayers).toEqual([]);
    expect(store.selectedNoteIds.has('a')).toBe(true); // untouched — just ineligible

    store.setLayerVisible(layerId, true);
    expect(store.selectionContext.count).toBe(1);
  });

  it('selectionContext drops a note reactively when its layer is locked', () => {
    const store = createStore();
    const layerId = store.layers[0].id;
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 1,
      velocity: 100,
      layerId,
    });
    store.selectNote('a', false);
    store.setLayerLocked(layerId, true);
    expect(store.selectionContext.count).toBe(0);
    store.setLayerLocked(layerId, false);
    expect(store.selectionContext.count).toBe(1);
  });

  it('selectionContext.activeLayers is the deduplicated set of layers referenced by the selection, in stack order', () => {
    const store = createStore();
    const firstId = store.layers[0].id;
    store.addLayer();
    const secondId = store.layers[0].id;
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 1,
      velocity: 100,
      layerId: firstId,
    });
    store.addNote({
      id: 'b',
      midiNote: 62,
      startBeat: 1,
      durationBeats: 1,
      velocity: 100,
      layerId: secondId,
    });
    store.addNote({
      id: 'c',
      midiNote: 64,
      startBeat: 2,
      durationBeats: 1,
      velocity: 100,
      layerId: firstId,
    });
    store.selectAll();
    expect(store.selectionContext.activeLayers.map((l) => l.id)).toEqual([secondId, firstId]);
  });

  it('selectAll only selects notes on visible, unlocked layers', () => {
    const store = createStore();
    const firstId = store.layers[0].id;
    store.addLayer();
    const secondId = store.layers[0].id;
    store.setLayerLocked(secondId, true);
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 1,
      velocity: 100,
      layerId: firstId,
    });
    store.addNote({
      id: 'b',
      midiNote: 62,
      startBeat: 1,
      durationBeats: 1,
      velocity: 100,
      layerId: secondId,
    });

    store.selectAll();
    expect([...store.selectedNoteIds]).toEqual(['a']);
  });

  it("paste falls back to the active layer when the copied note's original layer was deleted", () => {
    const store = createStore();
    const firstId = store.layers[0].id;
    store.addLayer();
    const secondId = store.layers[0].id;
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 1,
      velocity: 100,
      layerId: secondId,
    });
    store.selectNote('a', false);
    store.copy();

    store.removeLayer(secondId); // deletes 'a' along with its layer
    expect(store.activeLayerId).toBe(firstId);

    store.paste(4);
    expect(store.notes).toHaveLength(1);
    expect(store.notes[0].layerId).toBe(firstId);
  });

  it('paste keeps a note on its original layer when that layer still exists', () => {
    const store = createStore();
    const firstId = store.layers[0].id;
    store.addLayer();
    const secondId = store.layers[0].id;
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 1,
      velocity: 100,
      layerId: secondId,
    });
    store.selectNote('a', false);
    store.copy();
    store.activeLayerId = firstId;
    store.paste(4);
    const pasted = store.notes.find((n) => n.id !== 'a');
    expect(pasted?.layerId).toBe(secondId);
  });
});

// ── createStore — undo/redo integration ──────────────────────────────────────

describe('createStore — undo/redo', () => {
  it('undo restores previous notes state', () => {
    const store = createStore();
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });
    store.addNote({
      id: 'b',
      midiNote: 62,
      startBeat: 1,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });
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
    store.addNote({
      id: 'a',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 1,
      velocity: 100,
      layerId: store.layers[0].id,
    });
    store.selectNote('a', false);
    store.deleteSelected(); // records and removes 'a'
    expect(store.notes.length).toBe(0);
    store.undo(); // restore 'a'
    expect(store.notes.length).toBe(1);
    store.redo(); // re-delete 'a'
    expect(store.notes.length).toBe(0);
  });
});
