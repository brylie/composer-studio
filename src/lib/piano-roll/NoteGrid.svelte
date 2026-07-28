<script lang="ts">
  import { getEditorState } from './context.svelte.js';
  const { store } = getEditorState();
  import { isBlackKey, MIN_MIDI, MAX_MIDI, NOTE_COUNT } from './types.js';
  import type { Note } from './types.js';
  import { auditionNote } from './audio.js';
  import { scaleSegments } from './tracks.js';

  /** Shift or Ctrl/Cmd — the modifiers that mean "add to selection" rather than replace it. */
  function isAdditive(e: PointerEvent): boolean {
    return e.shiftKey || e.ctrlKey || e.metaKey;
  }

  // Grid dimensions
  const totalWidth = $derived(store.totalBeats * store.pixelsPerBeat);
  const totalHeight = $derived(NOTE_COUNT * store.rowHeight);

  // store.selectedNoteIds is already a reactive SvelteSet — use directly

  // Notes ordered high → low for row mapping
  const noteRange = Array.from({ length: NOTE_COUNT }, (_, i) => MAX_MIDI - i);

  function rowForMidi(midi: number): number {
    return MAX_MIDI - midi;
  }

  // Per-segment scale-degree highlighting (tracks.md#context-aware-highlighting).
  // Computed across the full timeline, not a scrolled viewport — the grid
  // isn't virtualized today, so there's no perf reason to restrict the range;
  // eventSegments' carry-in logic still applies correctly at range start 0.
  // One rect per (in-scale row, segment) pair — rows in-scale in one segment
  // and out-of-scale in the next must visibly change at the boundary, not
  // blend, which rules out a single full-row style.
  const scaleHighlightRects = $derived(
    scaleSegments(store.scaleTrack, 0, store.totalBeats).flatMap((segment) =>
      noteRange
        .filter((midi) => segment.scaleDegrees.has(midi % 12))
        .map((midi) => ({
          key: `${segment.event.id}:${String(segment.startBeat)}:${String(midi)}`,
          left: segment.startBeat * store.pixelsPerBeat,
          top: rowForMidi(midi) * store.rowHeight,
          width: (segment.endBeat - segment.startBeat) * store.pixelsPerBeat,
        })),
    ),
  );

  // Bar-line positions honoring time-signature changes (timeline.md), replacing
  // the previous hardcoded "every 4 beats" CSS repeating-gradient.
  const barLineLefts = $derived(store.barBeats.map((beat) => beat * store.pixelsPerBeat));

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
      row: Math.floor(y / store.rowHeight),
    };
  }

  function snapFloor(beat: number): number {
    const s = store.snapBeats;
    return Math.max(0, Math.floor(beat / s) * s);
  }

  // ── Pointer handlers ────────────────────────────────────────────────────────
  function handleGridDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();

    const target = e.target as HTMLElement;
    const noteEl = target.closest<HTMLElement>('[data-note-id]');

    if (noteEl) {
      const noteId = noteEl.dataset.noteId ?? '';
      const note = store.notes.find((n) => n.id === noteId);
      if (!note) return;

      const isCurrentlySelected = store.selectedNoteIds.has(noteId);

      // Update selection per mode/modifier matrix
      if (e.shiftKey) {
        // Shift+click → range select; no drag
        store.selectRange(noteId);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        return;
      } else if (e.ctrlKey || e.metaKey) {
        // Ctrl/Cmd+click → toggle; no drag if deselected
        store.selectNote(noteId, true);
        if (!store.selectedNoteIds.has(noteId)) {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          return;
        }
      } else if (!isCurrentlySelected) {
        store.selectNote(noteId, false); // exclusive select
        store.setAnchor(noteId);
      }
      // else: already selected, no modifier → keep multi-selection for drag

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
        if (selIds.size > 1 && selIds.has(noteId)) {
          // eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain lookup, never read reactively/in markup
          multiDragInitialPositions = new Map();
          for (const n of store.notes) {
            if (selIds.has(n.id)) {
              multiDragInitialPositions.set(n.id, { startBeat: n.startBeat, midiNote: n.midiNote });
            }
          }
        } else {
          multiDragInitialPositions = null;
        }
      }
    } else {
      // Empty space: begin drag-to-select rectangle.
      // In 'draw' mode, note creation is deferred until pointer up (if no significant drag).
      // In 'select' mode, empty-space click deselects (zero-size lasso) — no note created.
      if (!isAdditive(e)) store.deselectAll();
      const { beat, row } = getGridCoords(e);
      dragStartBeat = beat;
      dragStartRow = row;
      const x = beat * store.pixelsPerBeat;
      const y = row * store.rowHeight;
      selRect = { x0: x, y0: y, x1: x, y1: y };
      // Only defer note creation in draw mode
      pendingNoteCreate = store.interactionMode === 'draw' ? { beat, row } : null;
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
        y1: Math.max(dragStartRow * store.rowHeight, y),
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
        store.history.record('Resize note');
        didSnapshotDrag = true;
      }
      const note = store.notes.find((n) => n.id === activeNoteId);
      if (!note) return;
      const rawDur = beat - note.startBeat;
      const duration = Math.max(snap, Math.round(rawDur / snap) * snap);
      store.updateNote(activeNoteId, { durationBeats: duration });
    } else if (dragMode === 'move') {
      if (!didSnapshotDrag) {
        store.history.record('Move note');
        didSnapshotDrag = true;
      }
      if (multiDragInitialPositions) {
        // Move all selected notes by the same snapped delta in a single batch.
        // Clamp the shared delta once, using the group's min/max initial
        // positions, so the whole selection stays in-bounds together instead
        // of each note clamping independently and losing relative spacing.
        const rawDelta = beat - dragStartBeat;
        let snappedDelta = Math.round(rawDelta / snap) * snap;
        let rowDelta = row - dragStartRow;

        let minStartBeat = Infinity;
        let minRow = Infinity;
        let maxRow = -Infinity;
        for (const init of multiDragInitialPositions.values()) {
          if (init.startBeat < minStartBeat) minStartBeat = init.startBeat;
          const r = rowForMidi(init.midiNote);
          if (r < minRow) minRow = r;
          if (r > maxRow) maxRow = r;
        }
        snappedDelta = Math.max(snappedDelta, -minStartBeat);
        rowDelta = Math.max(rowDelta, -minRow);
        rowDelta = Math.min(rowDelta, NOTE_COUNT - 1 - maxRow);

        // eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain lookup passed straight to store.updateNotes, never read reactively
        const updates = new Map<string, Partial<Note>>();
        for (const [id, init] of multiDragInitialPositions) {
          const newBeat = init.startBeat + snappedDelta;
          const newRow = rowForMidi(init.midiNote) + rowDelta;
          updates.set(id, { startBeat: newBeat, midiNote: midiForRow(newRow) });
        }
        store.updateNotes(updates);
      } else {
        const newBeat = snapFloor(beat - dragOffsetBeat);
        const newRow = Math.max(0, Math.min(NOTE_COUNT - 1, row - dragOffsetRow));
        store.updateNote(activeNoteId, {
          startBeat: Math.max(0, newBeat),
          midiNote: midiForRow(newRow),
        });
      }
    }
  }

  function handlePointerUp(e: PointerEvent) {
    if (dragMode === 'select') {
      if (pendingNoteCreate) {
        // Click with no significant drag in draw mode → create a note
        const { beat, row } = pendingNoteCreate;
        const snappedBeat = snapFloor(beat);
        const midi = midiForRow(Math.max(0, Math.min(NOTE_COUNT - 1, row)));
        const id = generateId();
        store.history.record('Add note');
        store.addNote({
          id,
          midiNote: midi,
          startBeat: snappedBeat,
          durationBeats: store.snapBeats,
          velocity: 100,
        });
        store.selectNote(id, isAdditive(e));
        store.setAnchor(id);
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
        store.selectNotes(toSelect, isAdditive(e));
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
      store.history.record('Delete note');
      store.removeNote(noteEl.dataset.noteId ?? '');
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
  {#each noteRange as midi, i (midi)}
    <div
      class="row-bg"
      class:black-row={isBlackKey(midi)}
      class:c-row={midi % 12 === 0}
      style="top: {i * store.rowHeight}px; height: {store.rowHeight}px;"
    ></div>
  {/each}

  <!-- Scale-degree highlighting (tracks.md) — one band per (in-scale row, segment) -->
  {#each scaleHighlightRects as rect (rect.key)}
    <div
      class="scale-highlight"
      style="left: {rect.left}px; top: {rect.top}px; width: {rect.width}px; height: {store.rowHeight}px;"
    ></div>
  {/each}

  <!-- Beat/8th/16th subdivision lines via CSS background on overlay -->
  <div class="grid-lines" style="width: {totalWidth}px; height: {totalHeight}px;"></div>

  <!-- Bar lines, positioned per the time-signature track (timeline.md) -->
  {#each barLineLefts as left (left)}
    <div class="bar-line" style="left: {left}px; height: {totalHeight}px;"></div>
  {/each}

  <!-- Notes -->
  {#each store.notes as note (note.id)}
    {@const noteLeft = note.startBeat * store.pixelsPerBeat}
    {@const noteTop = rowForMidi(note.midiNote) * store.rowHeight + 1}
    {@const noteW = Math.max(6, note.durationBeats * store.pixelsPerBeat - 2)}
    {@const noteH = store.rowHeight - 2}
    <div
      data-note-id={note.id}
      class="note"
      class:selected={store.selectedNoteIds.has(note.id)}
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

  /* ── Scale-degree highlighting (tracks.md) ── */
  .scale-highlight {
    position: absolute;
    box-sizing: border-box;
    border-top: 1px solid var(--color-scale-degree, #38bdf8);
    border-bottom: 1px solid var(--color-scale-degree, #38bdf8);
    background: color-mix(in srgb, var(--color-scale-degree, #38bdf8) 8%, transparent);
    pointer-events: none;
  }

  /* ── Bar lines — positioned per the time-signature track, not a fixed interval ── */
  .bar-line {
    position: absolute;
    top: 0;
    width: 1px;
    background: #3a3a62;
    pointer-events: none;
  }

  /* ── Beat/8th/16th subdivision lines via CSS repeating-gradient ── */
  .grid-lines {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image:
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
