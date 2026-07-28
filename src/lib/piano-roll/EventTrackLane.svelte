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
  }: Props = $props();

  const width = $derived(totalBeats * pixelsPerBeat);

  function handleTrackPointerDown(e: PointerEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const beat = (e.clientX - rect.left) / pixelsPerBeat;
    const snapped = Math.max(0, Math.round(beat / snapBeats) * snapBeats);
    onAddAt(snapped);
  }

  function handleMarkerClick(e: MouseEvent, event: T) {
    e.stopPropagation();
    onSelect(event);
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
  aria-label="{label} track: click empty space to add a marker, click a marker to edit it"
>
  {#each events as event (event.id)}
    <button
      type="button"
      class="lane-marker"
      style="left: {event.beat * pixelsPerBeat}px;"
      onpointerdown={(e) => {
        e.stopPropagation();
      }}
      onclick={(e) => {
        handleMarkerClick(e, event);
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
    cursor: pointer;
    transition:
      background 0.12s,
      border-color 0.12s;
  }

  .lane-marker:hover {
    background: #2e2e58;
    border-color: #6b6bd9;
  }
</style>
