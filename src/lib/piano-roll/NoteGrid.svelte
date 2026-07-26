<script lang="ts">
	import { store } from './store.svelte.js';
	import { isBlackKey, MIN_MIDI, MAX_MIDI, NOTE_COUNT } from './types.js';
	import { auditionNote } from './audio.js';

	// Grid dimensions
	const totalWidth = $derived(store.totalBeats * store.pixelsPerBeat);
	const totalHeight = $derived(NOTE_COUNT * store.rowHeight);
	const barCount = $derived(Math.ceil(store.totalBeats / 4));

	// Selection set — fast membership lookup for rendering
	const selectedSet = $derived(new Set(store.selectedNoteIds));

	// Notes ordered high → low for row mapping
	const noteRange = Array.from({ length: NOTE_COUNT }, (_, i) => MAX_MIDI - i);

	function rowForMidi(midi: number): number {
		return MAX_MIDI - midi;
	}

	function midiForRow(row: number): number {
		return Math.max(MIN_MIDI, Math.min(MAX_MIDI, MAX_MIDI - row));
	}

	// ── Drag state ─────────────────────────────────────────────────────────────
	type DragMode = 'none' | 'add' | 'move' | 'resize' | 'select';
	let dragMode: DragMode = $state('none');
	let activeNoteId: string | null = $state(null);
	let dragOffsetBeat = $state(0);
	let dragOffsetRow = $state(0);
	let didSnapshotDrag = false;

	// Multi-note drag: initial positions of all selected notes at drag start
	let multiDragInitialPositions: Map<string, { startBeat: number; midiNote: number }> | null = null;
	let dragStartBeat = 0;
	let dragStartRow = 0;

	// Drag-to-select rectangle (pixel coords relative to grid)
	let selRect: { x0: number; y0: number; x1: number; y1: number } | null = $state(null);
	// Deferred note creation — set on empty-space click, cleared on first significant drag
	let pendingNoteCreate: { beat: number; row: number } | null = null;

	let gridEl: HTMLDivElement | null = $state(null);

	function generateId(): string {
		return crypto.randomUUID();
	}

	// ── Coordinate helpers ─────────────────────────────────────────────────────
	function getGridCoords(e: PointerEvent) {
		if (!gridEl) return { beat: 0, row: 0 };
		const rect = gridEl.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;
		return {
			beat: x / store.pixelsPerBeat,
			row: Math.floor(y / store.rowHeight)
		};
	}

	function snapFloor(beat: number): number {
		const s = store.snapBeats;
		return Math.max(0, Math.floor(beat / s) * s);
	}

	function snapRound(beat: number): number {
		const s = store.snapBeats;
		return Math.max(0, Math.round(beat / s) * s);
	}

	// ── Pointer handlers ────────────────────────────────────────────────────────
	function handleGridDown(e: PointerEvent) {
		if (e.button !== 0) return;
		e.preventDefault();

		const target = e.target as HTMLElement;
		const noteEl = target.closest<HTMLElement>('[data-note-id]');

		if (noteEl) {
			const noteId = noteEl.dataset.noteId!;
			const note = store.notes.find((n) => n.id === noteId);
			if (!note) return;

			const isCurrentlySelected = selectedSet.has(noteId);

			// Update selection
			if (e.shiftKey) {
				store.selectNote(noteId, true); // toggle
				if (isCurrentlySelected) {
					// Note was deselected — don't start a drag
					(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
					return;
				}
			} else if (!isCurrentlySelected) {
				store.selectNote(noteId, false); // exclusive select
			}
			// else: already selected, no shift → keep multi-selection for drag

			const noteRect = noteEl.getBoundingClientRect();
			const isRightEdge = e.clientX > noteRect.right - 8;

			if (isRightEdge) {
				dragMode = 'resize';
				activeNoteId = noteId;
				didSnapshotDrag = false;
			} else {
				dragMode = 'move';
				activeNoteId = noteId;
				didSnapshotDrag = false;
				const { beat, row } = getGridCoords(e);
				dragOffsetBeat = beat - note.startBeat;
				dragOffsetRow = row - rowForMidi(note.midiNote);
				dragStartBeat = beat;
				dragStartRow = row;

				// Multi-drag: activate when the dragged note is part of a multi-selection
				const selIds = store.selectedNoteIds;
				if (selIds.length > 1 && selIds.includes(noteId)) {
					multiDragInitialPositions = new Map();
					for (const id of selIds) {
						const n = store.notes.find((n) => n.id === id);
						if (n)
							multiDragInitialPositions.set(id, { startBeat: n.startBeat, midiNote: n.midiNote });
					}
				} else {
					multiDragInitialPositions = null;
				}
			}
		} else {
			// Empty space: begin drag-to-select; note creation is deferred until pointer up
			if (!e.shiftKey) store.deselectAll();
			const { beat, row } = getGridCoords(e);
			dragStartBeat = beat;
			dragStartRow = row;
			const x = beat * store.pixelsPerBeat;
			const y = row * store.rowHeight;
			selRect = { x0: x, y0: y, x1: x, y1: y };
			pendingNoteCreate = { beat, row };
			dragMode = 'select';
		}

		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function handlePointerMove(e: PointerEvent) {
		if (dragMode === 'none') return;

		const { beat, row } = getGridCoords(e);
		const snap = store.snapBeats;

		if (dragMode === 'select') {
			if (!selRect) return;
			const x = beat * store.pixelsPerBeat;
			const y = row * store.rowHeight;
			selRect = {
				x0: Math.min(dragStartBeat * store.pixelsPerBeat, x),
				y0: Math.min(dragStartRow * store.rowHeight, y),
				x1: Math.max(dragStartBeat * store.pixelsPerBeat, x),
				y1: Math.max(dragStartRow * store.rowHeight, y)
			};
			// Cancel deferred note creation once the user has dragged far enough
			if (selRect.x1 - selRect.x0 > 5 || selRect.y1 - selRect.y0 > 5) {
				pendingNoteCreate = null;
			}
			return;
		}

		if (!activeNoteId) return;

		if (dragMode === 'resize') {
			if (!didSnapshotDrag) {
				store.snapshotForUndo();
				didSnapshotDrag = true;
			}
			const note = store.notes.find((n) => n.id === activeNoteId);
			if (!note) return;
			const rawDur = beat - note.startBeat;
			const duration = Math.max(snap, Math.round(rawDur / snap) * snap);
			store.updateNote(activeNoteId, { durationBeats: duration });
		} else if (dragMode === 'move') {
			if (!didSnapshotDrag) {
				store.snapshotForUndo();
				didSnapshotDrag = true;
			}
			if (multiDragInitialPositions) {
				// Move all selected notes by the same snapped delta
				const rawDelta = beat - dragStartBeat;
				const snappedDelta = Math.round(rawDelta / snap) * snap;
				const rowDelta = row - dragStartRow;
				for (const [id, init] of multiDragInitialPositions) {
					const newBeat = Math.max(0, init.startBeat + snappedDelta);
					const newRow = Math.max(
						0,
						Math.min(NOTE_COUNT - 1, rowForMidi(init.midiNote) + rowDelta)
					);
					store.updateNote(id, { startBeat: newBeat, midiNote: midiForRow(newRow) });
				}
			} else {
				const newBeat = snapFloor(beat - dragOffsetBeat);
				const newRow = Math.max(0, Math.min(NOTE_COUNT - 1, row - dragOffsetRow));
				store.updateNote(activeNoteId, {
					startBeat: Math.max(0, newBeat),
					midiNote: midiForRow(newRow)
				});
			}
		}
	}

	function handlePointerUp(e: PointerEvent) {
		if (dragMode === 'select') {
			if (pendingNoteCreate) {
				// Click with no significant drag → create a note
				const { beat, row } = pendingNoteCreate;
				const snappedBeat = snapFloor(beat);
				const midi = midiForRow(Math.max(0, Math.min(NOTE_COUNT - 1, row)));
				const id = generateId();
				store.snapshotForUndo();
				store.addNote({
					id,
					midiNote: midi,
					startBeat: snappedBeat,
					durationBeats: store.snapBeats,
					velocity: 100
				});
				store.selectNote(id, false);
				auditionNote(midi, store.synthSettings);
			} else if (selRect) {
				// Rect drag → select all overlapping notes
				const rect = selRect;
				const toSelect = store.notes
					.filter((note) => {
						const nl = note.startBeat * store.pixelsPerBeat;
						const nr = nl + note.durationBeats * store.pixelsPerBeat;
						const nt = rowForMidi(note.midiNote) * store.rowHeight;
						const nb = nt + store.rowHeight;
						return nl < rect.x1 && nr > rect.x0 && nt < rect.y1 && nb > rect.y0;
					})
					.map((n) => n.id);
				store.selectNotes(toSelect, e.shiftKey);
			}
			selRect = null;
			pendingNoteCreate = null;
		}

		dragMode = 'none';
		activeNoteId = null;
		multiDragInitialPositions = null;
		didSnapshotDrag = false;
		const target = e.currentTarget as HTMLElement;
		if (target.hasPointerCapture(e.pointerId)) {
			target.releasePointerCapture(e.pointerId);
		}
	}

	function handleContextMenu(e: MouseEvent) {
		e.preventDefault();
		const noteEl = (e.target as HTMLElement).closest<HTMLElement>('[data-note-id]');
		if (noteEl) {
			store.snapshotForUndo();
			store.removeNote(noteEl.dataset.noteId!);
		}
	}
</script>

<!--
  NoteGrid renders its content without its own scroll wrapper.
  The parent (PianoRoll) owns the single shared scroll container.
-->
<div
	bind:this={gridEl}
	class="note-grid"
	role="application"
	aria-label="Note grid: click to add notes, drag to move, drag right edge to resize, right-click to delete"
	style="
    position: relative;
    width: {totalWidth}px;
    height: {totalHeight}px;
    --beat-px: {store.pixelsPerBeat}px;
    --bar-px: {store.pixelsPerBeat * 4}px;
    --eighth-px: {store.pixelsPerBeat * 0.5}px;
    --sixteenth-px: {store.pixelsPerBeat * 0.25}px;
    --row-h: {store.rowHeight}px;
  "
	onpointerdown={handleGridDown}
	onpointermove={handlePointerMove}
	onpointerup={handlePointerUp}
	oncontextmenu={handleContextMenu}
>
	<!-- Row backgrounds -->
	{#each noteRange as midi, i}
		<div
			class="row-bg"
			class:black-row={isBlackKey(midi)}
			class:c-row={midi % 12 === 0}
			style="top: {i * store.rowHeight}px; height: {store.rowHeight}px;"
		></div>
	{/each}

	<!-- Bar & beat lines via CSS background on overlay -->
	<div class="grid-lines" style="width: {totalWidth}px; height: {totalHeight}px;"></div>

	<!-- Notes -->
	{#each store.notes as note (note.id)}
		{@const noteLeft = note.startBeat * store.pixelsPerBeat}
		{@const noteTop = rowForMidi(note.midiNote) * store.rowHeight + 1}
		{@const noteW = Math.max(6, note.durationBeats * store.pixelsPerBeat - 2)}
		{@const noteH = store.rowHeight - 2}
		<div
			data-note-id={note.id}
			class="note"
			class:selected={selectedSet.has(note.id)}
			style="left: {noteLeft}px; top: {noteTop}px; width: {noteW}px; height: {noteH}px;"
		>
			<div class="resize-handle" data-resize></div>
		</div>
	{/each}

	<!-- Drag-to-select rectangle -->
	{#if selRect}
		<div
			class="sel-rect"
			style="left: {selRect.x0}px; top: {selRect.y0}px; width: {selRect.x1 -
				selRect.x0}px; height: {selRect.y1 - selRect.y0}px;"
		></div>
	{/if}

	<!-- Playhead -->
	<div
		class="playhead"
		style="left: {store.currentBeat * store.pixelsPerBeat}px; height: {totalHeight}px;"
	></div>
</div>

<style>
	.note-grid {
		cursor: crosshair;
		flex-shrink: 0;
	}

	/* ── Row backgrounds ── */
	.row-bg {
		position: absolute;
		left: 0;
		right: 0;
		background: #1e1e34;
	}

	.black-row {
		background: #181828;
	}

	.c-row {
		border-top: 1px solid #2e2e50;
	}

	/* ── Grid lines via CSS repeating-gradient ── */
	.grid-lines {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background-image:
      /* Bar lines (every 4 beats) — brightest */
			repeating-linear-gradient(
				to right,
				#3a3a62 0,
				#3a3a62 1px,
				transparent 1px,
				transparent var(--bar-px)
			),
			/* Beat lines (every 1 beat) — medium */
			repeating-linear-gradient(
					to right,
					#252545 0,
					#252545 1px,
					transparent 1px,
					transparent var(--beat-px)
				),
			/* 8th-note lines (every ½ beat) — subtle */
			repeating-linear-gradient(
					to right,
					#1e1e3c 0,
					#1e1e3c 1px,
					transparent 1px,
					transparent var(--eighth-px)
				),
			/* 16th-note lines (every ¼ beat) — very subtle */
			repeating-linear-gradient(
					to right,
					#191930 0,
					#191930 1px,
					transparent 1px,
					transparent var(--sixteenth-px)
				);
	}

	/* ── Notes ── */
	.note {
		position: absolute;
		background: #6b6bd9;
		border: 1px solid #8888ee;
		border-radius: 3px;
		cursor: grab;
		box-sizing: border-box;
		overflow: hidden;
	}

	.note:hover {
		background: #7878e8;
	}
	.note.selected {
		background: #8f8fff;
		border-color: #b4b4ff;
		box-shadow: 0 0 0 1px rgba(160, 160, 255, 0.4);
	}
	.note.selected:hover {
		background: #9a9aff;
	}
	.note:active {
		cursor: grabbing;
	}

	.resize-handle {
		position: absolute;
		right: 0;
		top: 0;
		bottom: 0;
		width: 8px;
		cursor: ew-resize;
		background: rgba(255, 255, 255, 0.18);
		border-radius: 0 2px 2px 0;
	}

	/* ── Selection rect ── */
	.sel-rect {
		position: absolute;
		border: 1px solid rgba(160, 160, 255, 0.8);
		background: rgba(100, 100, 200, 0.15);
		pointer-events: none;
		z-index: 25;
	}

	/* ── Playhead ── */
	.playhead {
		position: absolute;
		top: 0;
		width: 2px;
		background: rgba(255, 255, 255, 0.75);
		pointer-events: none;
		z-index: 20;
	}
</style>
