<script lang="ts">
  import type { Action } from 'svelte/action';
  import type { ArrangerSection } from './arranger.js';
  import { createArrangerLaneEditor } from './arranger-lane-editor.svelte.js';
  import ArrangerLane from './ArrangerLane.svelte';
  import ArrangerSectionEditor from './ArrangerSectionEditor.svelte';
  import ChordEventEditor from './ChordEventEditor.svelte';
  import { getEditorState } from './context.svelte.js';
  const { store, ribbonUi } = getEditorState();
  import CommandRibbon from './CommandRibbon.svelte';
  import { createLaneEditor } from './lane-editor.svelte.js';
  import EventTrackLane from './EventTrackLane.svelte';
  import LabelEventEditor from './LabelEventEditor.svelte';
  import LayerPanel from './LayerPanel.svelte';
  import NoteGrid from './NoteGrid.svelte';
  import OverlayShell from './OverlayShell.svelte';
  import PianoKeys from './PianoKeys.svelte';
  import ScaleEventEditor from './ScaleEventEditor.svelte';
  import SynthPanel from './SynthPanel.svelte';
  import TimeSignatureEventEditor from './TimeSignatureEventEditor.svelte';
  import type { ChordEvent, LabelEvent, ScaleEvent, TimeSignatureEvent } from './timeline.js';
  import Toolbar from './Toolbar.svelte';
  import TopBar from './TopBar.svelte';
  import { MAX_MIDI, NOTE_NAMES } from './types.js';

  let velDragNoteId: string | null = $state(null);
  let velScrollLeft = $state(0);

  const rulerWidth = $derived(store.totalBeats * store.pixelsPerBeat);

  // ── Event track lanes (tracks.md#shared-lane-component) ─────────────────
  // Stacked arranger → scale → chord → labels, per tracks.md's fixed lane
  // order. The scale/chord/labels lanes share createLaneEditor
  // (lane-editor.svelte.ts); the arranger lane's sections span a range and
  // support move/resize rather than a single beat, so it gets its own
  // ArrangerLane component and createArrangerLaneEditor controller
  // (arranger-lane-editor.svelte.ts) instead of reusing EventTrackLane.
  const RULER_HEIGHT = 24;
  const ARRANGER_LANE_HEIGHT = 28;
  const TIME_SIGNATURE_LANE_HEIGHT = 26;
  const SCALE_LANE_HEIGHT = 26;
  const CHORD_LANE_HEIGHT = 26;
  const LABELS_LANE_HEIGHT = 26;

  const arrangerLane = createArrangerLaneEditor(
    (id, updates) => {
      store.updateArrangerSection(id, updates);
    },
    (id) => {
      store.removeArrangerSection(id);
    },
  );

  const timeSignatureLane = createLaneEditor<TimeSignatureEvent>(
    () => store.timeSignatureTrack,
    (event) => {
      store.upsertTimeSignatureEvent(event);
    },
    (id) => {
      store.removeTimeSignatureEvent(id);
    },
    (id, beat) => {
      store.moveTimeSignatureEvent(id, beat);
    },
  );

  const scaleLane = createLaneEditor<ScaleEvent>(
    () => store.scaleTrack,
    (event) => {
      store.upsertScaleEvent(event);
    },
    (id) => {
      store.removeScaleEvent(id);
    },
    (id, beat) => {
      store.moveScaleEvent(id, beat);
    },
  );
  const chordLane = createLaneEditor<ChordEvent>(
    () => store.chordTrack,
    (event) => {
      store.upsertChordEvent(event);
    },
    (id) => {
      store.removeChordEvent(id);
    },
    (id, beat) => {
      store.moveChordEvent(id, beat);
    },
  );
  const labelLane = createLaneEditor<LabelEvent>(
    () => store.labelTrack,
    (event) => {
      store.upsertLabelEvent(event);
    },
    (id) => {
      store.removeLabelEvent(id);
    },
    (id, beat) => {
      store.moveLabelEvent(id, beat);
    },
  );

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
        <div
          class="scroll-content"
          style="width: max-content; min-height: 100%; grid-template-rows: {RULER_HEIGHT}px {ARRANGER_LANE_HEIGHT}px {TIME_SIGNATURE_LANE_HEIGHT}px {SCALE_LANE_HEIGHT}px {CHORD_LANE_HEIGHT}px {LABELS_LANE_HEIGHT}px auto;"
        >
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

          <!-- Arranger lane (tracks.md#arranger-track-placeholder) — topmost
               per the fixed stacking order (arranger, then scale, then
               chord, then labels). v1 is annotation-only: sections carry no
               notes/other-track content when added/moved/resized. -->
          <ArrangerLane
            sections={store.arrangerTrack}
            pixelsPerBeat={store.pixelsPerBeat}
            totalBeats={store.totalBeats}
            snapBeats={store.snapBeats}
            row={2}
            stickyTop={RULER_HEIGHT}
            height={ARRANGER_LANE_HEIGHT}
            onAddAt={store.addArrangerSection}
            onSelect={arrangerLane.openFor}
            onMove={(section: ArrangerSection, beat: number) => {
              store.moveArrangerSection(section.id, beat);
            }}
            onResizeStart={(section: ArrangerSection, beat: number) => {
              store.resizeArrangerSectionStart(section.id, beat);
            }}
            onResizeEnd={(section: ArrangerSection, beat: number) => {
              store.resizeArrangerSectionEnd(section.id, beat);
            }}
          />

          <!-- Time signature lane (tracks.md#time-signature-track-specified) —
               shares the tempo/time-signature lane row with the (not yet
               built) tempo track, per the fixed stacking order: arranger,
               then tempo/time-signature, then scale, then chord, then
               labels. -->
          <EventTrackLane
            label="Time Sig"
            events={store.timeSignatureTrack}
            pixelsPerBeat={store.pixelsPerBeat}
            totalBeats={store.totalBeats}
            snapBeats={store.snapBeats}
            row={3}
            stickyTop={RULER_HEIGHT + ARRANGER_LANE_HEIGHT}
            height={TIME_SIGNATURE_LANE_HEIGHT}
            onAddAt={timeSignatureLane.openAt}
            onSelect={timeSignatureLane.openFor}
            onMove={timeSignatureLane.move}
          >
            {#snippet marker(event: TimeSignatureEvent)}
              {event.numerator}/{event.denominator}
            {/snippet}
          </EventTrackLane>

          <!-- Scale lane (tracks.md) — synced scroll/zoom with the grid below via
               the same shared timeline grid, sticky just under the ruler. -->
          <EventTrackLane
            label="Scale"
            events={store.scaleTrack}
            pixelsPerBeat={store.pixelsPerBeat}
            totalBeats={store.totalBeats}
            snapBeats={store.snapBeats}
            row={4}
            stickyTop={RULER_HEIGHT + ARRANGER_LANE_HEIGHT + TIME_SIGNATURE_LANE_HEIGHT}
            height={SCALE_LANE_HEIGHT}
            onAddAt={scaleLane.openAt}
            onSelect={scaleLane.openFor}
            onMove={scaleLane.move}
          >
            {#snippet marker(event: ScaleEvent)}
              {NOTE_NAMES[event.root]} {event.mode}
            {/snippet}
          </EventTrackLane>

          <!-- Chord lane (tracks.md#chord-track-placeholder) — same lane
               component, one row below the scale lane per the fixed stacking
               order (arranger, time signature, scale, then chord, then labels). -->
          <EventTrackLane
            label="Chord"
            events={store.chordTrack}
            pixelsPerBeat={store.pixelsPerBeat}
            totalBeats={store.totalBeats}
            snapBeats={store.snapBeats}
            row={5}
            stickyTop={RULER_HEIGHT +
              ARRANGER_LANE_HEIGHT +
              TIME_SIGNATURE_LANE_HEIGHT +
              SCALE_LANE_HEIGHT}
            height={CHORD_LANE_HEIGHT}
            onAddAt={chordLane.openAt}
            onSelect={chordLane.openFor}
            onMove={chordLane.move}
          >
            {#snippet marker(event: ChordEvent)}
              {NOTE_NAMES[event.root]}{event.quality}
            {/snippet}
          </EventTrackLane>

          <!-- Labels lane (tracks.md#labels-track-placeholder) — freeform
               point annotations, placed just above the note grid. -->
          <EventTrackLane
            label="Labels"
            events={store.labelTrack}
            pixelsPerBeat={store.pixelsPerBeat}
            totalBeats={store.totalBeats}
            snapBeats={store.snapBeats}
            row={6}
            stickyTop={RULER_HEIGHT +
              ARRANGER_LANE_HEIGHT +
              TIME_SIGNATURE_LANE_HEIGHT +
              SCALE_LANE_HEIGHT +
              CHORD_LANE_HEIGHT}
            height={LABELS_LANE_HEIGHT}
            onAddAt={labelLane.openAt}
            onSelect={labelLane.openFor}
            onMove={labelLane.move}
          >
            {#snippet marker(event: LabelEvent)}
              {event.text}
            {/snippet}
          </EventTrackLane>

          <!-- Piano keys + note grid -->
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
    open={ribbonUi.layerPanelOpen}
    title="Layers"
    onclose={() => (ribbonUi.layerPanelOpen = false)}
  >
    <LayerPanel />
  </OverlayShell>

  <OverlayShell
    open={arrangerLane.target !== null}
    title="Arranger section"
    onclose={arrangerLane.close}
  >
    {#if arrangerLane.target}
      <ArrangerSectionEditor
        section={arrangerLane.target}
        onSave={arrangerLane.save}
        onDelete={arrangerLane.delete}
      />
    {/if}
  </OverlayShell>

  <OverlayShell
    open={timeSignatureLane.target !== null}
    title="Time signature marker"
    onclose={timeSignatureLane.close}
  >
    {#if timeSignatureLane.target}
      <TimeSignatureEventEditor
        beat={timeSignatureLane.target.beat}
        existing={timeSignatureLane.target.existing}
        onSave={timeSignatureLane.save}
        onDelete={timeSignatureLane.delete}
      />
    {/if}
  </OverlayShell>

  <OverlayShell open={scaleLane.target !== null} title="Scale marker" onclose={scaleLane.close}>
    {#if scaleLane.target}
      <ScaleEventEditor
        beat={scaleLane.target.beat}
        existing={scaleLane.target.existing}
        onSave={scaleLane.save}
        onDelete={scaleLane.delete}
      />
    {/if}
  </OverlayShell>

  <OverlayShell open={chordLane.target !== null} title="Chord marker" onclose={chordLane.close}>
    {#if chordLane.target}
      <ChordEventEditor
        beat={chordLane.target.beat}
        existing={chordLane.target.existing}
        onSave={chordLane.save}
        onDelete={chordLane.delete}
      />
    {/if}
  </OverlayShell>

  <OverlayShell open={labelLane.target !== null} title="Label marker" onclose={labelLane.close}>
    {#if labelLane.target}
      <LabelEventEditor
        beat={labelLane.target.beat}
        existing={labelLane.target.existing}
        onSave={labelLane.save}
        onDelete={labelLane.delete}
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
    /* row 1: ruler, row 2: arranger lane, row 3: time signature lane, row 4:
       scale lane, row 5: chord lane, row 6: labels lane (tracks.md's fixed
       stacking order), row 7: piano keys + note grid — heights set inline
       from RULER_HEIGHT/ARRANGER_LANE_HEIGHT/TIME_SIGNATURE_LANE_HEIGHT/
       SCALE_LANE_HEIGHT/CHORD_LANE_HEIGHT/LABELS_LANE_HEIGHT to keep this in
       sync. */
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
    grid-row: 7;
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
