<script lang="ts">
  import type { ArrangerSection } from './arranger.js';

  interface Props {
    sections: ArrangerSection[];
    pixelsPerBeat: number;
    totalBeats: number;
    snapBeats: number;
    /** CSS grid-row this lane occupies in the parent's shared timeline grid (tracks.md#shared-lane-component). */
    row: number;
    /** px offset from the scroll container's top this lane sticks to while scrolling vertically — same mechanism as the ruler. */
    stickyTop: number;
    height?: number;
    onAddAt: (beat: number) => void;
    /** A tap-without-drag on an existing section's body — opens the rename/delete editor. */
    onSelect: (section: ArrangerSection) => void;
    /** Called once, on drop, after a section body has been dragged past the move threshold. */
    onMove: (section: ArrangerSection, beat: number) => void;
    onResizeStart: (section: ArrangerSection, beat: number) => void;
    onResizeEnd: (section: ArrangerSection, beat: number) => void;
  }

  const {
    sections,
    pixelsPerBeat,
    totalBeats,
    snapBeats,
    row,
    stickyTop,
    height = 28,
    onAddAt,
    onSelect,
    onMove,
    onResizeStart,
    onResizeEnd,
  }: Props = $props();

  const width = $derived(totalBeats * pixelsPerBeat);

  // Snaps to the grid and clamps to [0, totalBeats] — the outer bound a
  // section edge may reach. Overlap-with-neighbor and minimum-length
  // clamping happen store-side (arranger.ts's gap-aware domain functions),
  // not here — this only keeps drag previews from running away past the
  // lane's own edges while a gesture is in progress.
  function snapToGrid(beat: number): number {
    const snapped = Math.round(beat / snapBeats) * snapBeats;
    return Math.max(0, Math.min(totalBeats, snapped));
  }

  // ── Empty-space tap-to-add ──────────────────────────────────────────────
  // Deferred to pointerup (same disambiguation pattern as EventTrackLane) —
  // the lane lives inside an `overflow: auto` shared scroll container, so a
  // gesture that starts on empty lane space and then moves must be free to
  // pan/scroll rather than immediately adding a section.
  const TAP_THRESHOLD_PX = 4;
  let pendingAddBeat: number | null = null;
  let addStartClientX = 0;
  let addStartClientY = 0;

  function handleTrackPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const beat = (e.clientX - rect.left) / pixelsPerBeat;
    // Clamped to totalBeats - snapBeats (not totalBeats itself, unlike
    // snapToGrid's generic [0, totalBeats] range used for move/resize
    // previews below) — a new section needs room to actually exist: at
    // beat === totalBeats exactly, addSectionAt's half-open gap check
    // (beat < gap.end) can never find a placement, so a tap at the very
    // right edge would silently do nothing instead of adding a
    // right-clamped section, the way EventTrackLane's marker-add clamp works.
    pendingAddBeat = Math.min(snapToGrid(beat), Math.max(0, totalBeats - snapBeats));
    addStartClientX = e.clientX;
    addStartClientY = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handleTrackPointerMove(e: PointerEvent) {
    if (pendingAddBeat === null) return;
    const dx = e.clientX - addStartClientX;
    const dy = e.clientY - addStartClientY;
    if (Math.hypot(dx, dy) > TAP_THRESHOLD_PX) pendingAddBeat = null;
  }

  function handleTrackPointerUp(e: PointerEvent) {
    const target = e.currentTarget as HTMLElement;
    if (target.hasPointerCapture(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }
    if (pendingAddBeat !== null) onAddAt(pendingAddBeat);
    pendingAddBeat = null;
  }

  function handleTrackPointerCancel() {
    pendingAddBeat = null;
  }

  // ── Section body drag-to-move ─────────────────────────────────────────────
  // Pointer events + a move threshold, same reasoning as EventTrackLane's
  // marker drag: disambiguates "click to edit" from "drag to move" instead
  // of treating every mousedown+mouseup as a click. The store isn't touched
  // until drop.
  const DRAG_THRESHOLD_PX = 4;
  let draggingId: string | null = $state(null);
  let dragPreviewStart = $state(0);
  let dragStartClientX = 0;
  let dragStartBeat = 0;
  let didDrag = false;

  function handleBodyPointerDown(e: PointerEvent, section: ArrangerSection) {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    draggingId = section.id;
    dragPreviewStart = section.startBeat;
    dragStartClientX = e.clientX;
    dragStartBeat = section.startBeat;
    didDrag = false;
  }

  function handleBodyPointerMove(e: PointerEvent) {
    if (draggingId === null) return;
    e.stopPropagation();
    const deltaX = e.clientX - dragStartClientX;
    if (Math.abs(deltaX) > DRAG_THRESHOLD_PX) didDrag = true;
    if (!didDrag) return;
    dragPreviewStart = snapToGrid(dragStartBeat + deltaX / pixelsPerBeat);
  }

  function endBodyDrag(e: PointerEvent) {
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    if (target.hasPointerCapture(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }
    draggingId = null;
    didDrag = false;
  }

  function handleBodyPointerUp(e: PointerEvent, section: ArrangerSection) {
    if (draggingId !== section.id) return;
    const shouldMove = didDrag;
    const targetBeat = dragPreviewStart;
    endBodyDrag(e);
    if (shouldMove) {
      onMove(section, targetBeat);
    } else {
      onSelect(section);
    }
  }

  function handleBodyPointerCancel(e: PointerEvent, section: ArrangerSection) {
    if (draggingId !== section.id) return;
    // Cancellation abandons the move outright — no onMove, no onSelect.
    endBodyDrag(e);
  }

  // ── Edge drag-to-resize ────────────────────────────────────────────────────
  // No tap-vs-drag disambiguation needed here (unlike the body/track above):
  // the handles have no "click" meaning of their own, and a no-movement
  // resize is already a no-op once it reaches the store (arranger.ts returns
  // the same array reference when the clamped result matches the current
  // edge).
  let resizingId: string | null = $state(null);
  let resizingEdge: 'start' | 'end' | null = $state(null);
  let resizePreviewBeat = $state(0);
  let resizeStartClientX = 0;
  let resizeAnchorBeat = 0;

  function handleResizePointerDown(
    e: PointerEvent,
    section: ArrangerSection,
    edge: 'start' | 'end',
  ) {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    resizingId = section.id;
    resizingEdge = edge;
    resizeAnchorBeat = edge === 'start' ? section.startBeat : section.endBeat;
    resizePreviewBeat = resizeAnchorBeat;
    resizeStartClientX = e.clientX;
  }

  function handleResizePointerMove(e: PointerEvent) {
    if (resizingId === null) return;
    e.stopPropagation();
    const deltaX = e.clientX - resizeStartClientX;
    resizePreviewBeat = snapToGrid(resizeAnchorBeat + deltaX / pixelsPerBeat);
  }

  function endResizeDrag(e: PointerEvent, section: ArrangerSection) {
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    if (target.hasPointerCapture(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }
    if (resizingEdge === 'start') {
      onResizeStart(section, resizePreviewBeat);
    } else if (resizingEdge === 'end') {
      onResizeEnd(section, resizePreviewBeat);
    }
    resizingId = null;
    resizingEdge = null;
  }

  function handleResizePointerUp(e: PointerEvent, section: ArrangerSection) {
    if (resizingId !== section.id) return;
    endResizeDrag(e, section);
  }

  function handleResizePointerCancel(e: PointerEvent, section: ArrangerSection) {
    if (resizingId !== section.id) return;
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    if (target.hasPointerCapture(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }
    resizingId = null;
    resizingEdge = null;
  }

  /** Arrow-key resizing by one grid step — the keyboard equivalent of dragging a handle. */
  function handleResizeKeydown(e: KeyboardEvent, section: ArrangerSection, edge: 'start' | 'end') {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const delta = e.key === 'ArrowLeft' ? -snapBeats : snapBeats;
    if (edge === 'start') {
      onResizeStart(section, section.startBeat + delta);
    } else {
      onResizeEnd(section, section.endBeat + delta);
    }
  }

  /** The [start, end) a section should render at right now, previewing whatever drag/resize is in progress on it. */
  function previewBounds(section: ArrangerSection): { start: number; end: number } {
    if (draggingId === section.id) {
      const duration = section.endBeat - section.startBeat;
      return { start: dragPreviewStart, end: dragPreviewStart + duration };
    }
    if (resizingId === section.id) {
      if (resizingEdge === 'start') return { start: resizePreviewBeat, end: section.endBeat };
      if (resizingEdge === 'end') return { start: section.startBeat, end: resizePreviewBeat };
    }
    return { start: section.startBeat, end: section.endBeat };
  }
</script>

<div class="lane-label" style="grid-row: {row}; height: {height}px; top: {stickyTop}px;">
  Arranger
</div>
<div
  class="lane-track arranger-track"
  style="grid-row: {row}; width: {width}px; height: {height}px; top: {stickyTop}px;"
  onpointerdown={handleTrackPointerDown}
  onpointermove={handleTrackPointerMove}
  onpointerup={handleTrackPointerUp}
  onpointercancel={handleTrackPointerCancel}
  role="group"
  aria-label="Arranger track: click empty space to add a section, drag a section to move it, drag its edge to resize, click a section to rename or delete it"
>
  {#each sections as section (section.id)}
    {@const bounds = previewBounds(section)}
    {@const left = bounds.start * pixelsPerBeat}
    {@const blockWidth = Math.max(4, (bounds.end - bounds.start) * pixelsPerBeat)}
    <div
      class="section-block"
      class:dragging={draggingId === section.id}
      class:resizing={resizingId === section.id}
      style="left: {left}px; width: {blockWidth}px; background: {section.color};"
      onpointerdown={(e) => {
        handleBodyPointerDown(e, section);
      }}
      onpointermove={handleBodyPointerMove}
      onpointerup={(e) => {
        handleBodyPointerUp(e, section);
      }}
      onpointercancel={(e) => {
        handleBodyPointerCancel(e, section);
      }}
      role="button"
      tabindex="0"
      aria-label="Section {section.label}, beats {section.startBeat} to {section.endBeat}"
      onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(section);
        }
      }}
    >
      <button
        type="button"
        class="resize-handle left"
        aria-label="Resize {section.label} start"
        onpointerdown={(e) => {
          handleResizePointerDown(e, section, 'start');
        }}
        onpointermove={handleResizePointerMove}
        onpointerup={(e) => {
          handleResizePointerUp(e, section);
        }}
        onpointercancel={(e) => {
          handleResizePointerCancel(e, section);
        }}
        onkeydown={(e) => {
          handleResizeKeydown(e, section, 'start');
        }}
      ></button>
      <span class="section-label">{section.label}</span>
      <button
        type="button"
        class="resize-handle right"
        aria-label="Resize {section.label} end"
        onpointerdown={(e) => {
          handleResizePointerDown(e, section, 'end');
        }}
        onpointermove={handleResizePointerMove}
        onpointerup={(e) => {
          handleResizePointerUp(e, section);
        }}
        onpointercancel={(e) => {
          handleResizePointerCancel(e, section);
        }}
        onkeydown={(e) => {
          handleResizeKeydown(e, section, 'end');
        }}
      ></button>
    </div>
  {/each}
</div>

<style>
  .lane-label {
    grid-column: 1;
    position: sticky;
    left: 0;
    z-index: 16;
    /* Fixed to the piano-keys column width (64px, matches PianoRoll.svelte's
       .corner-spacer) and clipped — "Arranger" is long enough at 10px that
       CSS Grid's default min-width:auto would otherwise let this item's
       intrinsic content width overflow past the grid track, overlapping the
       lane-track sibling and stealing its pointer events at the left edge. */
    width: 64px;
    box-sizing: border-box;
    overflow: hidden;
    display: flex;
    align-items: center;
    padding: 0 8px;
    background: #14141f;
    border-right: 1px solid #252540;
    border-bottom: 1px solid #252540;
    font-size: 10px;
    font-weight: 700;
    color: #666688;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .lane-track {
    grid-column: 2;
    position: sticky;
    z-index: 15;
    background: #14141f;
    border-bottom: 1px solid #252540;
    cursor: copy;
  }

  .section-block {
    position: absolute;
    top: 3px;
    bottom: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    color: #0d0d1c;
    font-size: 10px;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    cursor: grab;
    transition:
      filter 0.12s,
      box-shadow 0.12s;
  }

  .section-block:hover {
    filter: brightness(1.1);
  }

  .section-block.dragging {
    cursor: grabbing;
    box-shadow: 0 0 0 2px #f0f0ff;
    transition: none;
  }

  .section-block.resizing {
    box-shadow: 0 0 0 2px #f0f0ff;
    transition: none;
  }

  .section-label {
    padding: 0 10px;
    pointer-events: none;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .resize-handle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 8px;
    border: none;
    background: transparent;
    padding: 0;
    cursor: ew-resize;
  }

  .resize-handle.left {
    left: 0;
  }

  .resize-handle.right {
    right: 0;
  }
</style>
