<script lang="ts" generics="T extends { id: string; beat: number }">
  import type { Snippet } from 'svelte';

  interface Props {
    label: string;
    events: T[];
    pixelsPerBeat: number;
    totalBeats: number;
    snapBeats: number;
    /** CSS grid-row this lane occupies in the parent's shared timeline grid (tracks.md#shared-lane-component). */
    row: number;
    /** px offset from the scroll container's top this lane sticks to while scrolling vertically — same mechanism as the ruler. */
    stickyTop: number;
    height?: number;
    marker: Snippet<[T]>;
    onAddAt: (beat: number) => void;
    onSelect: (event: T) => void;
    /** Called once, on drop, after a marker has been dragged past the move threshold. */
    onMove: (event: T, beat: number) => void;
  }

  const {
    label,
    events,
    pixelsPerBeat,
    totalBeats,
    snapBeats,
    row,
    stickyTop,
    height = 26,
    marker,
    onAddAt,
    onSelect,
    onMove,
  }: Props = $props();

  const width = $derived(totalBeats * pixelsPerBeat);

  function snapBeat(beat: number): number {
    return Math.max(0, Math.round(beat / snapBeats) * snapBeats);
  }

  function handleTrackPointerDown(e: PointerEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const beat = (e.clientX - rect.left) / pixelsPerBeat;
    onAddAt(snapBeat(beat));
  }

  // ── Marker drag-to-move ──────────────────────────────────────────────────
  // Pointer events (not click) for the same reason NoteGrid's note-dragging
  // uses them: a threshold disambiguates "click to edit" from "drag to move"
  // rather than treating every mousedown+mouseup as a click. The store isn't
  // touched until drop — a marker occupying the target beat is only replaced
  // on release (upsertEvent's replace-at-beat semantics, timeline.md), not
  // transiently while merely passing over it mid-drag.
  const DRAG_THRESHOLD_PX = 4;
  let draggingId: string | null = $state(null);
  let dragPreviewBeat = $state(0);
  let dragStartClientX = 0;
  let dragStartBeat = 0;
  let didDrag = false;

  function handleMarkerPointerDown(e: PointerEvent, event: T) {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    draggingId = event.id;
    dragPreviewBeat = event.beat;
    dragStartClientX = e.clientX;
    dragStartBeat = event.beat;
    didDrag = false;
  }

  function handleMarkerPointerMove(e: PointerEvent) {
    if (draggingId === null) return;
    const deltaX = e.clientX - dragStartClientX;
    if (Math.abs(deltaX) > DRAG_THRESHOLD_PX) didDrag = true;
    if (!didDrag) return;
    dragPreviewBeat = snapBeat(dragStartBeat + deltaX / pixelsPerBeat);
  }

  function handleMarkerPointerUp(e: PointerEvent, event: T) {
    if (draggingId !== event.id) return;
    const target = e.currentTarget as HTMLElement;
    if (target.hasPointerCapture(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }
    if (didDrag) {
      onMove(event, dragPreviewBeat);
    } else {
      onSelect(event);
    }
    draggingId = null;
    didDrag = false;
  }
</script>

<div class="lane-label" style="grid-row: {row}; height: {height}px; top: {stickyTop}px;">
  {label}
</div>
<div
  class="lane-track"
  style="grid-row: {row}; width: {width}px; height: {height}px; top: {stickyTop}px;"
  onpointerdown={handleTrackPointerDown}
  role="group"
  aria-label="{label} track: click empty space to add a marker, drag a marker to move it, click a marker to edit it"
>
  {#each events as event (event.id)}
    {@const left = (draggingId === event.id ? dragPreviewBeat : event.beat) * pixelsPerBeat}
    <button
      type="button"
      class="lane-marker"
      class:dragging={draggingId === event.id}
      style="left: {left}px;"
      onpointerdown={(e) => {
        handleMarkerPointerDown(e, event);
      }}
      onpointermove={handleMarkerPointerMove}
      onpointerup={(e) => {
        handleMarkerPointerUp(e, event);
      }}
    >
      {@render marker(event)}
    </button>
  {/each}
</div>

<style>
  .lane-label {
    grid-column: 1;
    position: sticky;
    left: 0;
    z-index: 16;
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
  }

  .lane-track {
    grid-column: 2;
    position: sticky;
    z-index: 15;
    background: #14141f;
    border-bottom: 1px solid #252540;
    cursor: copy;
  }

  .lane-marker {
    position: absolute;
    top: 3px;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 1px 6px;
    border: 1px solid #3a3a62;
    border-radius: 4px;
    background: #232345;
    color: #c0c0e8;
    font-size: 10px;
    font-weight: 600;
    white-space: nowrap;
    cursor: grab;
    transition:
      background 0.12s,
      border-color 0.12s;
  }

  .lane-marker:hover {
    background: #2e2e58;
    border-color: #6b6bd9;
  }

  .lane-marker.dragging {
    cursor: grabbing;
    background: #2e2e58;
    border-color: #8f8fff;
    z-index: 1;
    transition: none;
  }
</style>
