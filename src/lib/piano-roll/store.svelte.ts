import { SvelteSet } from 'svelte/reactivity';
import { CommandHistory, isContiguous } from './history.js';
import type {
  ActiveScaleSegment,
  ChordEvent,
  ClipboardContents,
  CommandContext,
  DocumentSnapshot,
  GridInteractionMode,
  Layer,
  Note,
  SelectionAnchor,
  SelectionContext,
  SnapDenominator,
  SynthSettings,
} from './types.js';
import { clampNote } from './types.js';

export { CommandHistory, isContiguous };

const DEFAULT_SYNTH: SynthSettings = {
  waveform: 'triangle',
  volume: 90,
  envelope: { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.3 },
  filter: { enabled: false, cutoff: 2000, resonance: 1 },
};

// ── Store factory ──────────────────────────────────────────────────────────────

export function createStore() {
  let notes: Note[] = $state([]);
  let isPlaying = $state(false);
  let isRecording = $state(false);
  let currentBeat = $state(0);
  let snapDenominator: SnapDenominator = $state(4);
  let showVelocity = $state(false);
  let loopEnabled = $state(true);
  let totalBeats = $state(64); // 16 bars x 4 beats
  let pixelsPerBeat = $state(80);
  const rowHeight = $state(24);
  let tempo = $state(122);
  let synthSettings: SynthSettings = $state(structuredClone(DEFAULT_SYNTH));
  let trackName = $state('Untitled Track');
  let interactionMode: GridInteractionMode = $state('draw');

  // Selection
  const selectedNoteIds = new SvelteSet<string>();
  let selectionAnchor: SelectionAnchor | null = $state(null);

  // Clipboard
  let clipboard: ClipboardContents | null = $state(null);

  // History — core logic in plain TS; reactive mirrors keep UI in sync
  const _history = new CommandHistory();
  let _canUndo = $state(false);
  let _canRedo = $state(false);
  let _undoLabel = $state<string | undefined>(undefined);
  let _redoLabel = $state<string | undefined>(undefined);

  function syncHistory() {
    _canUndo = _history.canUndo;
    _canRedo = _history.canRedo;
    _undoLabel = _history.undoLabel;
    _redoLabel = _history.redoLabel;
  }

  const snapBeats = $derived(4 / snapDenominator);

  // ── Derived SelectionContext ──────────────────────────────────────────────

  const selectionContext = $derived.by((): SelectionContext => {
    const selected = notes
      .filter((n) => selectedNoteIds.has(n.id))
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
      isContiguous: isContiguous(selected),
      activeScales: [] as ActiveScaleSegment[], // Phase 6 stub
      activeLayers: [] as Layer[], // Phase 10 stub
    };
  });

  // ── Derived CommandContext (transformations.md) ─────────────────────

  const commandContext = $derived.by((): CommandContext => ({
    ...selectionContext,
    allNotes: notes,
    playhead: currentBeat,
    chordTrack: [] as ChordEvent[], // Phase 7 stub
  }));

  // ── Internal helpers ──────────────────────────────────────────────────────

  function extendTotalBeatsIfNeeded(note: Note) {
    const noteEnd = note.startBeat + note.durationBeats;
    if (noteEnd > totalBeats) {
      totalBeats = Math.ceil(noteEnd / 4) * 4;
    }
  }

  function currentSnapshot(): Omit<DocumentSnapshot, 'label'> {
    return { notes: $state.snapshot(notes) };
  }

  function recordHistory(label: string) {
    _history.record(label, currentSnapshot);
    syncHistory();
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  function addNote(note: Note) {
    if (notes.some((n) => n.id === note.id)) return;
    const clamped = clampNote(note);
    notes = [...notes, clamped];
    extendTotalBeatsIfNeeded(clamped);
  }

  function removeNote(id: string) {
    notes = notes.filter((n) => n.id !== id);
    selectedNoteIds.delete(id);
    if (selectionAnchor?.noteId === id) selectionAnchor = null;
  }

  function updateNote(id: string, updates: Partial<Note>) {
    notes = notes.map((n) => {
      if (n.id !== id) return n;
      const merged = clampNote({ ...n, ...updates });
      extendTotalBeatsIfNeeded(merged);
      return merged;
    });
  }

  /**
   * Applies per-note updates in a single pass over the notes array. Use this
   * instead of calling updateNote() in a loop (e.g. during multi-note drag)
   * to avoid re-traversing the full array once per note.
   */
  function updateNotes(updatesById: Map<string, Partial<Note>>) {
    if (updatesById.size === 0) return;
    notes = notes.map((n) => {
      const updates = updatesById.get(n.id);
      if (!updates) return n;
      const merged = clampNote({ ...n, ...updates });
      extendTotalBeatsIfNeeded(merged);
      return merged;
    });
  }

  function clearNotes() {
    notes = [];
    selectedNoteIds.clear();
    selectionAnchor = null;
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  function selectNote(id: string, addToSelection: boolean) {
    if (addToSelection) {
      if (selectedNoteIds.has(id)) {
        selectedNoteIds.delete(id);
      } else {
        selectedNoteIds.add(id);
      }
    } else {
      selectedNoteIds.clear();
      selectedNoteIds.add(id);
    }
  }

  function selectAll() {
    for (const n of notes) selectedNoteIds.add(n.id);
  }

  function deselectAll() {
    selectedNoteIds.clear();
    selectionAnchor = null;
  }

  function selectNotes(ids: string[], addToSelection: boolean) {
    if (!addToSelection) selectedNoteIds.clear();
    for (const id of ids) selectedNoteIds.add(id);
  }

  function setAnchor(noteId: string) {
    selectionAnchor = { noteId };
  }

  function clearAnchor() {
    selectionAnchor = null;
  }

  /**
   * Range-selects from the current anchor to focusNoteId. Anchor index is
   * re-derived at call-time from the current sorted note order so stale
   * indices cannot exist. Falls back to single-select when no anchor is set.
   */
  function selectRange(focusNoteId: string) {
    if (!selectionAnchor) {
      selectedNoteIds.clear();
      selectedNoteIds.add(focusNoteId);
      return;
    }
    const anchor = selectionAnchor;
    const sorted = notes
      .slice()
      .sort((a, b) => a.startBeat - b.startBeat || a.midiNote - b.midiNote);
    const anchorIndex = sorted.findIndex((n) => n.id === anchor.noteId);
    const focusIndex = sorted.findIndex((n) => n.id === focusNoteId);
    if (anchorIndex === -1 || focusIndex === -1) {
      selectionAnchor = null;
      selectedNoteIds.clear();
      if (focusIndex !== -1) selectedNoteIds.add(focusNoteId);
      return;
    }
    const lo = Math.min(anchorIndex, focusIndex);
    const hi = Math.max(anchorIndex, focusIndex);
    selectedNoteIds.clear();
    for (let i = lo; i <= hi; i++) selectedNoteIds.add(sorted[i].id);
  }

  function deleteSelected() {
    if (selectedNoteIds.size === 0) return;
    recordHistory('Delete selected');
    notes = notes.filter((n) => !selectedNoteIds.has(n.id));
    selectedNoteIds.clear();
    selectionAnchor = null;
  }

  // ── Clipboard ─────────────────────────────────────────────────────────────

  function copy() {
    const selected = notes
      .filter((n) => selectedNoteIds.has(n.id))
      .sort((a, b) => a.startBeat - b.startBeat);
    if (selected.length === 0) return;
    const earliest = selected[0].startBeat;
    clipboard = {
      notes: selected.map((n) => ({ ...n, startBeat: n.startBeat - earliest })),
    };
  }

  function paste(atBeat: number) {
    if (!clipboard || clipboard.notes.length === 0) return;
    recordHistory('Paste');
    const newNotes = clipboard.notes.map((n) =>
      clampNote({ ...n, id: crypto.randomUUID(), startBeat: n.startBeat + atBeat }),
    );
    notes = [...notes, ...newNotes];
    for (const n of newNotes) extendTotalBeatsIfNeeded(n);
    selectedNoteIds.clear();
    for (const n of newNotes) selectedNoteIds.add(n.id);
  }

  function duplicateSelection() {
    const ctx = selectionContext;
    if (ctx.count === 0 || !ctx.beatRange) return;
    recordHistory('Duplicate');
    const span = ctx.beatRange.end - ctx.beatRange.start;
    const duped = ctx.notes.map((n) =>
      clampNote({ ...n, id: crypto.randomUUID(), startBeat: n.startBeat + span }),
    );
    notes = [...notes, ...duped];
    for (const n of duped) extendTotalBeatsIfNeeded(n);
    selectedNoteIds.clear();
    for (const n of duped) selectedNoteIds.add(n.id);
  }

  // ── Undo / Redo ───────────────────────────────────────────────────────────

  /** After restoring `notes` from a history entry, drop selection ids that no longer exist. */
  function pruneSelectionToExistingNotes() {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain local lookup, discarded immediately, never read reactively
    const ids = new Set(notes.map((n) => n.id));
    for (const id of selectedNoteIds) {
      if (!ids.has(id)) selectedNoteIds.delete(id);
    }
  }

  function undo() {
    const entry = _history.undo(currentSnapshot);
    syncHistory();
    if (!entry) return;
    notes = entry.notes;
    pruneSelectionToExistingNotes();
  }

  function redo() {
    const entry = _history.redo(currentSnapshot);
    syncHistory();
    if (!entry) return;
    notes = entry.notes;
    pruneSelectionToExistingNotes();
  }

  // ── Commands (transformations.md) ─────────────────────────────────

  /**
   * Applies a CommandDescriptor.run() result: records history (before the
   * mutation, per command-history.md), replaces the whole-document notes
   * array with the command's returned set (re-clamped defensively), and
   * prunes selection to whatever notes still exist — same pattern as
   * undo()/redo() above.
   */
  function applyCommandResult(result: { notes: Note[]; label: string }) {
    recordHistory(result.label);
    const clamped = result.notes.map(clampNote);
    notes = clamped;
    for (const n of clamped) extendTotalBeatsIfNeeded(n);
    pruneSelectionToExistingNotes();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  return {
    get notes() {
      return notes;
    },

    get isPlaying() {
      return isPlaying;
    },
    set isPlaying(v: boolean) {
      isPlaying = v;
    },

    get isRecording() {
      return isRecording;
    },
    set isRecording(v: boolean) {
      isRecording = v;
    },

    get currentBeat() {
      return currentBeat;
    },
    set currentBeat(v: number) {
      currentBeat = v;
    },

    get snapDenominator() {
      return snapDenominator;
    },
    set snapDenominator(v: SnapDenominator) {
      snapDenominator = v;
    },

    get showVelocity() {
      return showVelocity;
    },
    set showVelocity(v: boolean) {
      showVelocity = v;
    },

    get loopEnabled() {
      return loopEnabled;
    },
    set loopEnabled(v: boolean) {
      loopEnabled = v;
    },

    get totalBeats() {
      return totalBeats;
    },

    get pixelsPerBeat() {
      return pixelsPerBeat;
    },
    set pixelsPerBeat(v: number) {
      pixelsPerBeat = Math.max(20, Math.min(240, v));
    },

    get rowHeight() {
      return rowHeight;
    },

    get tempo() {
      return tempo;
    },
    set tempo(v: number) {
      tempo = v;
    },

    get synthSettings() {
      return synthSettings;
    },
    set synthSettings(v: SynthSettings) {
      synthSettings = v;
    },

    get trackName() {
      return trackName;
    },
    set trackName(v: string) {
      trackName = v;
    },

    get snapBeats() {
      return snapBeats;
    },

    get selectedNoteIds() {
      return selectedNoteIds;
    },

    get selectionAnchor() {
      return selectionAnchor;
    },

    get interactionMode() {
      return interactionMode;
    },
    set interactionMode(v: GridInteractionMode) {
      interactionMode = v;
    },

    get clipboard() {
      return clipboard;
    },

    get selectionContext() {
      return selectionContext;
    },

    get commandContext() {
      return commandContext;
    },

    /** Reactive-mirrored view of history state for UI bindings. */
    get history() {
      return {
        get canUndo() {
          return _canUndo;
        },
        get canRedo() {
          return _canRedo;
        },
        get undoLabel() {
          return _undoLabel;
        },
        get redoLabel() {
          return _redoLabel;
        },
        record(label: string, snapshot: () => Omit<DocumentSnapshot, 'label'> = currentSnapshot) {
          _history.record(label, snapshot);
          syncHistory();
        },
      };
    },

    addNote,
    removeNote,
    updateNote,
    updateNotes,
    clearNotes,
    selectNote,
    selectAll,
    deselectAll,
    selectNotes,
    setAnchor,
    clearAnchor,
    selectRange,
    deleteSelected,
    copy,
    paste,
    duplicateSelection,
    undo,
    redo,
    applyCommandResult,
  };
}

export type Store = ReturnType<typeof createStore>;
