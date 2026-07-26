import type { Note, SynthSettings, SnapDenominator } from './types.js';

const DEFAULT_SYNTH: SynthSettings = {
	waveform: 'triangle',
	volume: 90,
	envelope: { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.3 },
	filter: { enabled: false, cutoff: 2000, resonance: 1 }
};

function createStore() {
	let notes: Note[] = $state([]);
	let isPlaying = $state(false);
	let isRecording = $state(false);
	let currentBeat = $state(0);
	let snapDenominator: SnapDenominator = $state(4);
	let showVelocity = $state(false);
	let loopEnabled = $state(true);
	let totalBeats = $state(64); // 16 bars × 4 beats
	let pixelsPerBeat = $state(80);
	let rowHeight = $state(24);
	let tempo = $state(122);
	let synthSettings: SynthSettings = $state(structuredClone(DEFAULT_SYNTH));
	let trackName = $state('Untitled Track');

	// Selection
	let selectedNoteIds: string[] = $state([]);

	// Undo / redo stacks (plain arrays, not reactive — only notes matter)
	const undoStack: Note[][] = [];
	const redoStack: Note[][] = [];

	const snapBeats = $derived(4 / snapDenominator);

	function addNote(note: Note) {
		// Guard against duplicate IDs (defensive, UUIDs should be unique)
		if (notes.some((n) => n.id === note.id)) return;
		notes = [...notes, note];
	}

	function removeNote(id: string) {
		notes = notes.filter((n) => n.id !== id);
		selectedNoteIds = selectedNoteIds.filter((sid) => sid !== id);
	}

	function updateNote(id: string, updates: Partial<Note>) {
		notes = notes.map((n) => (n.id === id ? { ...n, ...updates } : n));
	}

	function clearNotes() {
		notes = [];
		selectedNoteIds = [];
	}

	// ── Undo / Redo ──────────────────────────────────────────────────
	function snapshotForUndo() {
		undoStack.push(notes.map((n) => ({ ...n })));
		redoStack.length = 0;
		if (undoStack.length > 50) undoStack.shift();
	}

	function undo() {
		if (undoStack.length === 0) return;
		redoStack.push(notes.map((n) => ({ ...n })));
		notes = undoStack.pop()!;
		const ids = new Set(notes.map((n) => n.id));
		selectedNoteIds = selectedNoteIds.filter((id) => ids.has(id));
	}

	function redo() {
		if (redoStack.length === 0) return;
		undoStack.push(notes.map((n) => ({ ...n })));
		notes = redoStack.pop()!;
		const ids = new Set(notes.map((n) => n.id));
		selectedNoteIds = selectedNoteIds.filter((id) => ids.has(id));
	}

	// ── Selection ────────────────────────────────────────────────────
	function selectNote(id: string, addToSelection: boolean) {
		if (addToSelection) {
			selectedNoteIds = selectedNoteIds.includes(id)
				? selectedNoteIds.filter((sid) => sid !== id)
				: [...selectedNoteIds, id];
		} else {
			selectedNoteIds = [id];
		}
	}

	function selectAll() {
		selectedNoteIds = notes.map((n) => n.id);
	}

	function deselectAll() {
		selectedNoteIds = [];
	}

	function selectNotes(ids: string[], addToSelection: boolean) {
		if (addToSelection) {
			const existing = new Set(selectedNoteIds);
			for (const id of ids) existing.add(id);
			selectedNoteIds = Array.from(existing);
		} else {
			selectedNoteIds = [...ids];
		}
	}

	function deleteSelected() {
		if (selectedNoteIds.length === 0) return;
		snapshotForUndo();
		const toDelete = new Set(selectedNoteIds);
		notes = notes.filter((n) => !toDelete.has(n.id));
		selectedNoteIds = [];
	}

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
			pixelsPerBeat = v;
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

		addNote,
		removeNote,
		updateNote,
		clearNotes,
		selectNote,
		selectNotes,
		selectAll,
		deselectAll,
		deleteSelected,
		snapshotForUndo,
		undo,
		redo
	};
}

export const store = createStore();
