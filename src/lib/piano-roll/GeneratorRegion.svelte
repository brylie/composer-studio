<script lang="ts">
  // Bounded generator session region on the note grid (generators.md §4.3,
  // §7.1, §15): horizontal handles resize time bounds, vertical handles
  // resize pitch bounds, the body drags the whole region, and a compact
  // reroll affordance sits on the region itself. Bounds only recompute on
  // pointer release (generators.md §15) — during a drag this renders a local
  // draft rect without touching the store, so a long drag doesn't
  // re-evaluate the recipe on every pointermove.
  import { getEditorState } from './context.svelte.js';
  import Icon from './Icon.svelte';
  import type { GeneratorBounds } from './generators/types.js';
  import { MAX_MIDI, MIN_MIDI } from './types.js';

  const { store } = getEditorState();

  const session = $derived(store.generatorSession);

  function rowForMidi(midi: number): number {
    return MAX_MIDI - midi;
  }

  type DragKind = 'move' | 'resize-left' | 'resize-right' | 'resize-top' | 'resize-bottom';
  let dragKind: DragKind | null = $state(null);
  let dragStartClientX = 0;
  let dragStartClientY = 0;
  let dragStartBounds: GeneratorBounds | null = null;
  let draftBounds: GeneratorBounds | null = $state(null);

  // The rect actually rendered — the live draft while dragging, otherwise the session's committed bounds.
  const displayBounds = $derived(draftBounds ?? session?.bounds ?? null);

  function beginDrag(e: PointerEvent, kind: DragKind) {
    if (!session || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragKind = kind;
    dragStartClientX = e.clientX;
    dragStartClientY = e.clientY;
    dragStartBounds = session.bounds;
    draftBounds = session.bounds;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function clampPitch(min: number, max: number): { minMidi: number; maxMidi: number } {
    const minMidi = Math.max(MIN_MIDI, Math.min(MAX_MIDI, min));
    const maxMidi = Math.max(MIN_MIDI, Math.min(MAX_MIDI, max));
    return minMidi <= maxMidi ? { minMidi, maxMidi } : { minMidi: maxMidi, maxMidi: minMidi };
  }

  /**
   * Translates (not resizes) `bounds` by a beat/row delta, always preserving
   * both the time span and the pitch span. Clamping the *delta* itself
   * (rather than clamping each endpoint independently, as the old move
   * handler did) is what keeps the span intact at a boundary — clamping
   * minMidi and maxMidi separately can shrink the span instead of just
   * stopping the drag, e.g. dragging a 12-semitone-tall region up against
   * MAX_MIDI used to collapse it toward a single pitch.
   */
  function translateBounds(
    bounds: GeneratorBounds,
    deltaBeats: number,
    deltaRows: number,
  ): GeneratorBounds {
    const span = bounds.time.endBeat - bounds.time.startBeat;
    const newStart = Math.max(0, bounds.time.startBeat + deltaBeats);
    const pitchSpan = bounds.pitch.maxMidi - bounds.pitch.minMidi;
    const clampedDeltaRows = Math.max(
      bounds.pitch.maxMidi - MAX_MIDI,
      Math.min(bounds.pitch.minMidi - MIN_MIDI, deltaRows),
    );
    const minMidi = bounds.pitch.minMidi - clampedDeltaRows;
    return {
      time: { startBeat: newStart, endBeat: newStart + span },
      pitch: { minMidi, maxMidi: minMidi + pitchSpan },
      allowTail: bounds.allowTail,
    };
  }

  function handlePointerMove(e: PointerEvent) {
    if (!dragKind || !dragStartBounds) return;
    const snap = store.snapBeats;
    const deltaBeats =
      Math.round((e.clientX - dragStartClientX) / store.pixelsPerBeat / snap) * snap;
    const deltaRows = Math.round((e.clientY - dragStartClientY) / store.rowHeight);
    const bounds = dragStartBounds;

    if (dragKind === 'move') {
      draftBounds = translateBounds(bounds, deltaBeats, deltaRows);
    } else if (dragKind === 'resize-left') {
      const newStart = Math.max(
        0,
        Math.min(bounds.time.endBeat - snap, bounds.time.startBeat + deltaBeats),
      );
      draftBounds = { ...bounds, time: { startBeat: newStart, endBeat: bounds.time.endBeat } };
    } else if (dragKind === 'resize-right') {
      const newEnd = Math.max(bounds.time.startBeat + snap, bounds.time.endBeat + deltaBeats);
      draftBounds = { ...bounds, time: { startBeat: bounds.time.startBeat, endBeat: newEnd } };
    } else if (dragKind === 'resize-top') {
      const { minMidi, maxMidi } = clampPitch(
        bounds.pitch.minMidi,
        bounds.pitch.maxMidi - deltaRows,
      );
      draftBounds = { ...bounds, pitch: { minMidi, maxMidi } };
    } else {
      const { minMidi, maxMidi } = clampPitch(
        bounds.pitch.minMidi - deltaRows,
        bounds.pitch.maxMidi,
      );
      draftBounds = { ...bounds, pitch: { minMidi, maxMidi } };
    }
  }

  function endDrag(e: PointerEvent) {
    if (dragKind && draftBounds) {
      store.updateGeneratorBounds(draftBounds);
    }
    dragKind = null;
    dragStartBounds = null;
    draftBounds = null;
    const target = e.currentTarget as HTMLElement;
    if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
  }

  /** Keyboard equivalent of a handle drag (generators.md §7.7) — one discrete step, recomputed immediately. */
  function handleKeydown(e: KeyboardEvent, kind: DragKind) {
    if (!session) return;
    const bounds = session.bounds;
    const snap = store.snapBeats;
    let next: GeneratorBounds | null = null;

    if (
      kind === 'move' &&
      (e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown')
    ) {
      const deltaBeats = e.key === 'ArrowLeft' ? -snap : e.key === 'ArrowRight' ? snap : 0;
      // translateBounds' deltaRows follows the pointer-move convention
      // (positive = dragged down = pitch decreases), so ArrowUp — which must
      // raise the region's pitch — maps to a negative delta, and ArrowDown
      // to a positive one; the reverse of a naive "up key → +1" mapping.
      const deltaRows = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
      next = translateBounds(bounds, deltaBeats, deltaRows);
    } else if (kind === 'resize-left' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const delta = e.key === 'ArrowLeft' ? -snap : snap;
      const newStart = Math.max(
        0,
        Math.min(bounds.time.endBeat - snap, bounds.time.startBeat + delta),
      );
      next = { ...bounds, time: { startBeat: newStart, endBeat: bounds.time.endBeat } };
    } else if (kind === 'resize-right' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const delta = e.key === 'ArrowLeft' ? -snap : snap;
      const newEnd = Math.max(bounds.time.startBeat + snap, bounds.time.endBeat + delta);
      next = { ...bounds, time: { startBeat: bounds.time.startBeat, endBeat: newEnd } };
    } else if (kind === 'resize-top' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const delta = e.key === 'ArrowUp' ? 1 : -1;
      const { minMidi, maxMidi } = clampPitch(bounds.pitch.minMidi, bounds.pitch.maxMidi + delta);
      next = { ...bounds, pitch: { minMidi, maxMidi } };
    } else if (kind === 'resize-bottom' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const delta = e.key === 'ArrowUp' ? 1 : -1;
      const { minMidi, maxMidi } = clampPitch(bounds.pitch.minMidi + delta, bounds.pitch.maxMidi);
      next = { ...bounds, pitch: { minMidi, maxMidi } };
    }

    if (next) {
      e.preventDefault();
      store.updateGeneratorBounds(next);
    }
  }
</script>

{#if session && displayBounds}
  {@const left = displayBounds.time.startBeat * store.pixelsPerBeat}
  {@const width = (displayBounds.time.endBeat - displayBounds.time.startBeat) * store.pixelsPerBeat}
  {@const top = rowForMidi(displayBounds.pitch.maxMidi) * store.rowHeight}
  {@const height =
    (displayBounds.pitch.maxMidi - displayBounds.pitch.minMidi + 1) * store.rowHeight}
  <div
    class="generator-region"
    class:stale={session.status === 'stale'}
    class:error={session.status === 'error'}
    style="left: {left}px; top: {top}px; width: {width}px; height: {height}px;"
    role="group"
    aria-label="Generator session region: {session.name}, {session.status}"
    onpointerdown={(e) => {
      e.stopPropagation();
    }}
  >
    <button
      type="button"
      class="region-body"
      aria-label="Move generator region"
      onpointerdown={(e) => {
        beginDrag(e, 'move');
      }}
      onpointermove={handlePointerMove}
      onpointerup={endDrag}
      onkeydown={(e) => {
        handleKeydown(e, 'move');
      }}
    >
      <span class="region-label">
        {session.name}
        {#if session.status === 'stale'}
          <span class="status-badge">stale</span>
        {:else if session.status === 'error'}
          <span class="status-badge status-error">error</span>
        {:else if session.status === 'evaluating'}
          <span class="status-badge">…</span>
        {/if}
      </span>
    </button>

    <button
      type="button"
      class="reroll-btn"
      aria-label="Reroll {session.name}"
      title="Reroll (unlocked dimensions only)"
      onclick={() => {
        store.rerollGeneratorSession();
      }}
    >
      <Icon name="dice" />
    </button>

    <button
      type="button"
      class="handle handle-left"
      aria-label="Resize generator start beat"
      onpointerdown={(e) => {
        beginDrag(e, 'resize-left');
      }}
      onpointermove={handlePointerMove}
      onpointerup={endDrag}
      onkeydown={(e) => {
        handleKeydown(e, 'resize-left');
      }}
    ></button>
    <button
      type="button"
      class="handle handle-right"
      aria-label="Resize generator end beat"
      onpointerdown={(e) => {
        beginDrag(e, 'resize-right');
      }}
      onpointermove={handlePointerMove}
      onpointerup={endDrag}
      onkeydown={(e) => {
        handleKeydown(e, 'resize-right');
      }}
    ></button>
    <button
      type="button"
      class="handle handle-top"
      aria-label="Resize generator maximum pitch"
      onpointerdown={(e) => {
        beginDrag(e, 'resize-top');
      }}
      onpointermove={handlePointerMove}
      onpointerup={endDrag}
      onkeydown={(e) => {
        handleKeydown(e, 'resize-top');
      }}
    ></button>
    <button
      type="button"
      class="handle handle-bottom"
      aria-label="Resize generator minimum pitch"
      onpointerdown={(e) => {
        beginDrag(e, 'resize-bottom');
      }}
      onpointermove={handlePointerMove}
      onpointerup={endDrag}
      onkeydown={(e) => {
        handleKeydown(e, 'resize-bottom');
      }}
    ></button>
  </div>
{/if}

<style>
  .generator-region {
    position: absolute;
    box-sizing: border-box;
    border: 2px solid #f5b942;
    background: rgba(245, 185, 66, 0.08);
    z-index: 15;
  }

  .generator-region.stale {
    border-style: dashed;
  }

  .generator-region.error {
    border-color: #ef8080;
    background: rgba(239, 128, 128, 0.1);
  }

  .region-body {
    position: absolute;
    inset: 0;
    border: none;
    background: transparent;
    cursor: grab;
    padding: 0;
    display: flex;
    align-items: flex-start;
    justify-content: flex-start;
  }

  .region-body:active {
    cursor: grabbing;
  }

  .region-label {
    margin: 3px 0 0 6px;
    padding: 1px 6px;
    background: #f5b942;
    color: #1a1305;
    font-size: 10px;
    font-weight: 700;
    border-radius: 3px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    pointer-events: none;
    white-space: nowrap;
  }

  .status-badge {
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 9px;
  }

  .status-error {
    color: #6b1414;
  }

  .reroll-btn {
    position: absolute;
    top: 3px;
    right: 3px;
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 4px;
    background: #1a1305;
    color: #f5b942;
    cursor: pointer;
    z-index: 1;
  }

  .reroll-btn:hover {
    background: #2a2010;
  }

  .handle {
    position: absolute;
    border: none;
    background: transparent;
    padding: 0;
    z-index: 1;
  }

  .handle:focus-visible {
    outline: 2px solid #fff;
    outline-offset: -2px;
  }

  .handle-left,
  .handle-right {
    top: 0;
    bottom: 0;
    width: 7px;
    cursor: ew-resize;
  }

  .handle-left {
    left: -2px;
  }

  .handle-right {
    right: -2px;
  }

  .handle-top,
  .handle-bottom {
    left: 0;
    right: 0;
    height: 7px;
    cursor: ns-resize;
  }

  .handle-top {
    top: -2px;
  }

  .handle-bottom {
    bottom: -2px;
  }
</style>
