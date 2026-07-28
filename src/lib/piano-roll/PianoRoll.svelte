<script lang="ts">
  import type { Action } from 'svelte/action';
  import { getEditorState } from './context.svelte.js';
  const { store, ribbonUi } = getEditorState();
  import CommandRibbon from './CommandRibbon.svelte';
  import EventTrackLane from './EventTrackLane.svelte';
  import NoteGrid from './NoteGrid.svelte';
  import OverlayShell from './OverlayShell.svelte';
  import PianoKeys from './PianoKeys.svelte';
  import ScaleEventEditor from './ScaleEventEditor.svelte';
  import SynthPanel from './SynthPanel.svelte';
  import type { ScaleEvent } from './timeline.js';
  import Toolbar from './Toolbar.svelte';
  import TopBar from './TopBar.svelte';
  import { MAX_MIDI, NOTE_NAMES } from './types.js';

  let velDragNoteId: string | null = $state(null);
  let velScrollLeft = $state(0);

  const rulerWidth = $derived(store.totalBeats * store.pixelsPerBeat);

  // ── Scale lane (tracks.md) ──────────────────────────────────────────────
  const RULER_HEIGHT = 24;
  const SCALE_LANE_HEIGHT = 26;

  interface ScaleEditorTarget {
    beat: number;
    existing: ScaleEvent | null;
  }
  let scaleEditorTarget: ScaleEditorTarget | null = $state(null);

  function openScaleEditorAt(beat: number) {
    const existing = store.scaleTrack.find((e) => e.beat === beat) ?? null;
    scaleEditorTarget = { beat, existing };
  }

  function openScaleEditorFor(event: ScaleEvent) {
    scaleEditorTarget = { beat: event.beat, existing: event };
  }

  function saveScaleEvent(event: ScaleEvent) {
    store.upsertScaleEvent(event);
    scaleEditorTarget = null;
  }

  function deleteScaleEvent(id: string) {
    store.removeScaleEvent(id);
    scaleEditorTarget = null;
  }

  // Derived playhead X position — null when not playing (disables auto-scroll)
  const autoScrollX = $derived(store.isPlaying ? store.currentBeat * store.pixelsPerBeat : null);

  /**
   * Svelte action that handles all imperative scroll-container setup:
   * - Initial scroll to C4 region on mount
   * - Ctrl+scroll / pinch-to-zoom
   * - Velocity-lane scroll sync (reads el.scrollLeft, writes velScrollLeft)
   * - Reactive auto-scroll via `update(target)` called when autoScrollX changes
   */
  const scrollAreaAction: Action<HTMLDivElement, number | null> = (el, initialTarget) => {
    // Scroll to C4 area on first mount
    const MIDI_C4 = 60;
    const c4Row = MAX_MIDI - MIDI_C4;
    el.scrollTop = Math.max(0, c4Row * store.rowHeight - el.clientHeight * 0.33);

    // Ctrl+scroll (or trackpad pinch) → horizontal zoom
    function handleWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      store.pixelsPerBeat = store.pixelsPerBeat + (e.deltaY > 0 ? -20 : 20);
    }
    el.addEventListener('wheel', handleWheel, { passive: false });

    // Keep velocity lane scroll in sync
    function syncVel() {
      velScrollLeft = el.scrollLeft;
    }
    el.addEventListener('scroll', syncVel, { passive: true });

    // Handle initial target (may already be playing on mount)
    const applyAutoScroll = (target: number) => {
      const viewRight = el.scrollLeft + el.clientWidth - 64;
      if (target > viewRight - 120) el.scrollLeft = target - 120;
    };
    if (initialTarget !== null) applyAutoScroll(initialTarget);

    return {
      update(newTarget: number | null) {
        if (newTarget !== null) applyAutoScroll(newTarget);
      },
      destroy() {
        el.removeEventListener('wheel', handleWheel);
        el.removeEventListener('scroll', syncVel);
      },
    };
  };

  // ── Velocity lane interaction ──────────────────────────────────────────────
  function velPointerDown(e: PointerEvent) {
    const noteEl = (e.target as HTMLElement).closest<HTMLElement>('[data-vel-note-id]');
    if (!noteEl) return;
    velDragNoteId = noteEl.dataset.velNoteId ?? '';
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    updateVelocityFromEvent(e);
  }

  function updateVelocityFromEvent(e: PointerEvent) {
    if (!velDragNoteId) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const relY = e.clientY - rect.top;
    const velocity = Math.max(1, Math.min(127, Math.round(127 * (1 - relY / rect.height))));
    store.updateNote(velDragNoteId, { velocity });
  }

  function velPointerMove(e: PointerEvent) {
    if (!velDragNoteId) return;
    updateVelocityFromEvent(e);
  }

  function velPointerUp(e: PointerEvent) {
    velDragNoteId = null;
    const target = e.currentTarget as HTMLElement;
    if (target.hasPointerCapture(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }
  }
</script>

<div class="piano-roll">
  <TopBar />

  {#if !ribbonUi.previewMode}
    <Toolbar />
    <CommandRibbon />
  {/if}

  <!-- Screen-reader announcement of the last command/undo/redo result — reuses
       the label already produced for the undo stack, per accessibility.md. -->
  <div class="sr-only" aria-live="polite">{store.history.undoLabel ?? ''}</div>

  <!-- ── Main body ── -->
  <div class="body">
    <!-- Grid area: scroll container + velocity lane stacked vertically -->
    <div class="grid-area">
      <!-- Single shared scroll container for piano keys + grid -->
      <div class="scroll-area" use:scrollAreaAction={autoScrollX}>
        <div class="scroll-content" style="width: max-content; min-height: 100%;">
          <!-- Top-left corner (aligned with ruler) -->
          <div class="corner-spacer" style="position: sticky; left: 0; z-index: 30;"></div>

          <!-- Measure ruler (sticky top, scrolls horizontally) — bar positions
               follow the time-signature track (timeline.md), not a hardcoded
               4-beat assumption. -->
          <div class="ruler" style="width: {rulerWidth}px; position: sticky; top: 0; z-index: 20;">
            {#each store.barBeats as barBeat, i (barBeat)}
              <div class="bar-marker" style="left: {barBeat * store.pixelsPerBeat}px;">
                {i + 1}
              </div>
            {/each}
          </div>

          <!-- Scale lane (tracks.md) — synced scroll/zoom with the grid below via
               the same shared timeline grid, sticky just under the ruler. -->
          <EventTrackLane
            label="Scale"
            events={store.scaleTrack}
            pixelsPerBeat={store.pixelsPerBeat}
            totalBeats={store.totalBeats}
            snapBeats={store.snapBeats}
            row={2}
            stickyTop={RULER_HEIGHT}
            height={SCALE_LANE_HEIGHT}
            onAddAt={openScaleEditorAt}
            onSelect={openScaleEditorFor}
          >
            {#snippet marker(event: ScaleEvent)}
              {NOTE_NAMES[event.root]} {event.mode}
            {/snippet}
          </EventTrackLane>

          <!-- Third row: piano keys + note grid -->
          <div class="grid-row">
            <!-- Piano keys: sticky left -->
            <PianoKeys />

            <!-- Note grid content -->
            <NoteGrid />
          </div>
        </div>
      </div>

      <!-- Velocity lane — always visible at bottom, scrolls with grid -->
      {#if store.showVelocity}
        <div class="vel-section">
          <div class="vel-header-col">VEL</div>
          <!-- viewport clips content; inner div is shifted to match scroll -->
          <div
            class="vel-bars-viewport"
            onpointerdown={velPointerDown}
            onpointermove={velPointerMove}
            onpointerup={velPointerUp}
            role="group"
            aria-label="Velocity lane: drag bars to adjust note velocity"
          >
            <div
              class="vel-bars-inner"
              style="transform: translateX({-velScrollLeft}px); width: {rulerWidth}px;"
            >
              {#each store.notes as note (note.id)}
                {@const barLeft = note.startBeat * store.pixelsPerBeat}
                {@const barW = Math.max(4, note.durationBeats * store.pixelsPerBeat - 2)}
                {@const barH = Math.round((note.velocity / 127) * 68)}
                <div
                  class="vel-bar"
                  data-vel-note-id={note.id}
                  style="left: {barLeft}px; width: {barW}px; height: {barH}px;"
                ></div>
              {/each}
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>

  <OverlayShell
    open={ribbonUi.soundDrawerOpen}
    title="Sound"
    onclose={() => (ribbonUi.soundDrawerOpen = false)}
  >
    <SynthPanel />
  </OverlayShell>

  <OverlayShell
    open={scaleEditorTarget !== null}
    title="Scale marker"
    onclose={() => (scaleEditorTarget = null)}
  >
    {#if scaleEditorTarget}
      <ScaleEventEditor
        beat={scaleEditorTarget.beat}
        existing={scaleEditorTarget.existing}
        onSave={saveScaleEvent}
        onDelete={deleteScaleEvent}
      />
    {/if}
  </OverlayShell>
</div>

<style>
  .piano-roll {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: #1a1a2e;
    color: #e0e0f0;
    font-family:
      system-ui,
      -apple-system,
      sans-serif;
    user-select: none;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  /* ── Body layout ── */
  .body {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  /* ── Grid area (scroll + velocity lane, stacked) ── */
  .grid-area {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
  }

  /* ── Scroll area ── */
  .scroll-area {
    flex: 1;
    overflow: auto;
    position: relative;
  }

  .scroll-content {
    display: grid;
    /* col 1: piano key width (sticky), col 2: rest */
    grid-template-columns: 64px 1fr;
    /* row 1: ruler, row 2: scale lane (tracks.md), row 3: piano keys + note grid */
    grid-template-rows: 24px 26px auto;
  }

  /* ── Corner spacer ── */
  .corner-spacer {
    grid-column: 1;
    grid-row: 1;
    background: #0f0f1e;
    border-right: 1px solid #252540;
    border-bottom: 1px solid #252540;
    width: 64px;
    height: 24px;
  }

  /* ── Ruler ── */
  .ruler {
    grid-column: 2;
    grid-row: 1;
    height: 24px;
    background: #111120;
    border-bottom: 1px solid #252540;
    position: relative;
    overflow: visible;
  }

  .bar-marker {
    position: absolute;
    top: 4px;
    font-size: 10px;
    color: #555577;
    padding-left: 4px;
    user-select: none;
    white-space: nowrap;
  }

  /* ── Grid row: piano keys + note grid ── */
  .grid-row {
    grid-column: 1 / -1;
    grid-row: 3;
    display: flex;
    align-items: flex-start;
  }

  /* ── Velocity lane ── */
  .vel-section {
    display: flex;
    height: 80px;
    flex-shrink: 0;
    border-top: 1px solid #252540;
    background: #111122;
  }

  .vel-header-col {
    width: 64px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    color: #666688;
    font-weight: 600;
    letter-spacing: 0.06em;
    border-right: 1px solid #252540;
  }

  .vel-bars-viewport {
    flex: 1;
    overflow: hidden;
    position: relative;
    cursor: ns-resize;
  }

  .vel-bars-inner {
    position: relative;
    height: 100%;
    will-change: transform;
  }

  .vel-bar {
    position: absolute;
    bottom: 4px;
    background: #6b6bd9;
    border-radius: 2px 2px 0 0;
    opacity: 0.85;
    user-select: none;
  }

  .vel-bar:hover {
    opacity: 1;
    background: #8888ee;
  }
</style>
