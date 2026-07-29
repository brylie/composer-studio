import { SvelteSet } from 'svelte/reactivity';
import type { ArrangerTrack } from './arranger.js';
import {
  addSectionAt,
  moveSection,
  removeSection as removeArrangerSectionFromTrack,
  resizeSectionEnd,
  resizeSectionStart,
  updateSection,
} from './arranger.js';
import { disposeLayer } from './audio.js';
import { commandRegistry } from './commands/index.js';
import { CommandHistory, isContiguous } from './history.js';
import {
  createDefaultLayer,
  isLayerSelectable,
  moveLayer as moveLayerInStack,
  nextLayerColor,
} from './layers.js';
import type {
  ChordEvent,
  ChordTrack,
  EventTrack,
  LabelEvent,
  LabelTrack,
  ScaleEvent,
  ScaleTrack,
  TempoTrack,
  TimelineEvent,
  TimeSignatureEvent,
  TimeSignatureTrack,
} from './timeline.js';
import { activeEventAt, barBeats, beatGroupLines, removeEvent, upsertEvent } from './timeline.js';
import { scaleSegments } from './tracks.js';
import type {
  ClipboardContents,
  CommandContext,
  DocumentSnapshot,
  GridInteractionMode,
  Layer,
  LayerStack,
  Note,
  SelectionAnchor,
  SelectionContext,
  SnapDenominator,
  SynthSettings,
} from './types.js';
import { clampNote, DEFAULT_SYNTH } from './types.js';

export { CommandHistory, isContiguous };

/**
 * Add/remove/move mutators shared by every event track (scale/chord/labels —
 * timeline.md's family of point-event tracks). Each call records history
 * before mutating, per command-history.md, and delegates the actual
 * replace-at-beat/remove logic to timeline.ts's upsertEvent/removeEvent —
 * this factory only owns the "which track, which labels" wiring so
 * store.svelte.ts doesn't triplicate the same three functions per track type.
 */
function createEventTrackMutators<T extends TimelineEvent>(
  get: () => EventTrack<T>,
  set: (next: EventTrack<T>) => void,
  recordHistory: (label: string) => void,
  labels: { upsert: string; remove: string; move: string },
) {
  function upsert(event: T) {
    recordHistory(labels.upsert);
    set(upsertEvent(get(), event));
  }

  function remove(id: string) {
    recordHistory(labels.remove);
    set(removeEvent(get(), id));
  }

  /**
   * Moves the marker `id` to `beat`, keeping its other fields. Distinct from
   * upsert's add-or-replace because a move must remove the event from its
   * *old* beat first, then re-place it (via upsertEvent's own
   * replace-at-beat semantics if `beat` is already occupied by a different
   * marker). The no-op check compares against the clamped beat so e.g.
   * dragging a marker already at beat 0 to a negative beat is correctly
   * recognized as unchanged, rather than recording a history entry for a
   * mutation that clamps back to the same position.
   */
  function move(id: string, beat: number) {
    const track = get();
    const existing = track.find((e) => e.id === id);
    if (!existing) return;
    const clampedBeat = Math.max(0, beat);
    if (existing.beat === clampedBeat) return;
    recordHistory(labels.move);
    set(upsertEvent(removeEvent(track, id), { ...existing, beat: clampedBeat }));
  }

  return { upsert, remove, move };
}

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
  let trackName = $state('Untitled Track');
  let interactionMode: GridInteractionMode = $state('draw');

  // ── Layers (layers.md) ──────────────────────────────────────────────────
  // Instruments as layers over the single shared Note[]/timeline, not
  // separate tracks — see layers.md's resolution. Starts with one default
  // layer wrapping what used to be the document-wide synthSettings, so
  // every note (including ones created before any layer UI exists) always
  // has a real layer to land on.
  const initialLayer = createDefaultLayer(structuredClone(DEFAULT_SYNTH));
  let layers: LayerStack = $state([initialLayer]);
  let activeLayerId = $state(initialLayer.id);

  function layerFor(layerId: string): Layer | undefined {
    return layers.find((l) => l.id === layerId);
  }

  function activeLayer(): Layer | undefined {
    return layerFor(activeLayerId);
  }

  // ── Timeline event tracks (timeline.md, tracks.md) ─────────────────────────
  // Single event at beat 0 by default — "a project with no further events
  // behaves exactly as today" (timeline.md). Tempo automation (more than one
  // TempoEvent) and a time-signature editing UI are both explicit future
  // work, not built here; the data model already supports either.
  let tempoTrack: TempoTrack = $state([{ id: crypto.randomUUID(), beat: 0, bpm: 122 }]);
  let timeSignatureTrack: TimeSignatureTrack = $state([
    { id: crypto.randomUUID(), beat: 0, numerator: 4, denominator: 4 },
  ]);
  let scaleTrack: ScaleTrack = $state([
    { id: crypto.randomUUID(), beat: 0, root: 0, mode: 'major' },
  ]);
  // Chord/labels tracks start empty — unlike the scale track, there's no
  // sensible default marker to seed (tracks.md's chord/labels tracks).
  let chordTrack: ChordTrack = $state([]);
  let labelTrack: LabelTrack = $state([]);
  // Arranger track (tracks.md#arranger-track-placeholder) — starts empty,
  // same reasoning as chord/labels above.
  let arrangerTrack: ArrangerTrack = $state([]);

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

  // Bar-line beat positions across the timeline, honoring time-signature
  // changes (timeline.md) — replaces the note grid's previous hardcoded
  // "every 4 beats" assumption.
  const barBeatPositions = $derived(barBeats(timeSignatureTrack, totalBeats));

  // Beat-grouping tick positions, one tier finer than bar lines
  // (tracks.md#effect-on-the-piano-roll-grid) — computed per bar from
  // whichever TimeSignatureEvent is active at that bar's start, so a
  // mid-timeline meter change changes the grouping from that bar onward.
  const beatGroupLinePositions = $derived(
    barBeatPositions.flatMap((barStart) => {
      const sig = activeEventAt(timeSignatureTrack, barStart) ?? {
        id: '',
        beat: 0,
        numerator: 4,
        denominator: 4,
      };
      return beatGroupLines(sig, barStart);
    }),
  );

  // ── Derived SelectionContext ──────────────────────────────────────────────

  const selectionContext = $derived.by((): SelectionContext => {
    // Layer visibility/lock gate the *effective* selection continuously
    // (selection.md#selectioncontext--what-transformations-actually-read):
    // if a selected note's layer is later hidden/locked without the
    // selection itself changing, it must drop out of this derivation, not
    // just be excluded at the moment it was clicked.
    const selected = notes
      .filter((n) => selectedNoteIds.has(n.id) && isLayerSelectable(layerFor(n.layerId)))
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

    // A selection can span a scale change — sliced per selection.md's
    // activeScales, not a single "first scale wins" read.
    const activeScales = beatRange
      ? scaleSegments(scaleTrack, beatRange.start, beatRange.end).map((segment) => ({
          scale: segment.event,
          start: segment.startBeat,
          end: segment.endBeat,
        }))
      : [];

    // Distinct layers referenced by the (already-filtered) selection, in
    // panel/z-order — selection.md#activelayers-selection-spans-layers-freely-by-design.
    // Each layer in `layers` is visited once, so no separate dedup set is
    // needed: the `some()` check alone guarantees each qualifying layer is
    // pushed at most once.
    const activeLayers = layers.filter((layer) => selected.some((n) => n.layerId === layer.id));

    return {
      notes: selected,
      count,
      pitchRange,
      beatRange,
      isContiguous: isContiguous(selected),
      activeScales,
      activeLayers,
    };
  });

  // ── Derived CommandContext (transformations.md) ─────────────────────

  const commandContext = $derived.by((): CommandContext => ({
    ...selectionContext,
    allNotes: notes,
    playhead: currentBeat,
    chordTrack,
    activeLayerId,
  }));

  // ── Internal helpers ──────────────────────────────────────────────────────

  function extendTotalBeatsIfNeeded(note: Note) {
    const noteEnd = note.startBeat + note.durationBeats;
    if (noteEnd > totalBeats) {
      totalBeats = Math.ceil(noteEnd / 4) * 4;
    }
  }

  function currentSnapshot(): Omit<DocumentSnapshot, 'label'> {
    return {
      notes: $state.snapshot(notes),
      timeSignatureEvents: $state.snapshot(timeSignatureTrack),
      scaleEvents: $state.snapshot(scaleTrack),
      chordEvents: $state.snapshot(chordTrack),
      labelEvents: $state.snapshot(labelTrack),
      arrangerSections: $state.snapshot(arrangerTrack),
      layers: $state.snapshot(layers),
    };
  }

  /**
   * After restoring `layers` from a history entry, `activeLayerId` (presentation
   * state, not part of the snapshot per layers.md) may point at a layer that
   * undo/redo just removed — fall back to the new topmost layer rather than
   * leaving it dangling.
   */
  function revalidateActiveLayer() {
    if (!layers.some((l) => l.id === activeLayerId)) {
      activeLayerId = layers[0].id;
    }
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
    // layers.md#rendering-and-interaction-rules: select-all only reaches
    // notes on visible, unlocked layers, same as click/marquee.
    for (const n of notes) {
      if (isLayerSelectable(layerFor(n.layerId))) selectedNoteIds.add(n.id);
    }
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
    // Gate on selectionContext.notes, not raw selectedNoteIds — a selected
    // note whose layer is now hidden/locked isn't part of the effective
    // selection (selection.md#selectioncontext) and must survive Delete.
    const eligible = selectionContext.notes;
    if (eligible.length === 0) return;
    recordHistory('Delete selected');
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain lookup passed straight to the filter below, discarded immediately, never read reactively
    const idsToDelete = new Set(eligible.map((n) => n.id));
    notes = notes.filter((n) => !idsToDelete.has(n.id));
    pruneSelectionToExistingNotes();
    selectionAnchor = null;
  }

  // ── Clipboard ─────────────────────────────────────────────────────────────

  function copy() {
    // Same layer-gating as deleteSelected — a locked/hidden-layer note that's
    // still in selectedNoteIds shouldn't be copyable via Ctrl/Cmd+C.
    const selected = selectionContext.notes;
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
      clampNote({
        ...n,
        id: crypto.randomUUID(),
        startBeat: n.startBeat + atBeat,
        // layers.md#clipboard-preserve-layer-membership-across-copypaste:
        // stay on the original layer; fall back to the active layer only if
        // that layer was deleted between copy and paste.
        layerId: layerFor(n.layerId) ? n.layerId : activeLayerId,
      }),
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

  // ── Event track: time signature (tracks.md#time-signature-track-specified) ─
  // Upsert reuses createEventTrackMutators like scale/chord/labels below;
  // remove/move are bespoke because the beat-0 marker must always exist —
  // deleting it, or dragging it off beat 0, is not offered, the same "a
  // document can't have zero tempo" guarantee the tempo track already
  // relies on (timeline.md#data-model-additions).

  const timeSignatureTrackMutators = createEventTrackMutators<TimeSignatureEvent>(
    () => timeSignatureTrack,
    (next) => {
      timeSignatureTrack = next;
    },
    recordHistory,
    {
      upsert: 'Set time signature marker',
      remove: 'Remove time signature marker',
      move: 'Move time signature marker',
    },
  );

  function removeTimeSignatureEvent(id: string) {
    const event = timeSignatureTrack.find((e) => e.id === id);
    if (!event || event.beat === 0) return;
    timeSignatureTrackMutators.remove(id);
  }

  function moveTimeSignatureEvent(id: string, beat: number) {
    const event = timeSignatureTrack.find((e) => e.id === id);
    if (event?.beat === 0 && beat !== 0) return;
    timeSignatureTrackMutators.move(id, beat);
  }

  // ── Event tracks: scale, chord, labels (tracks.md) ───────────────────────
  // Each track's add/remove/move mutators are generated by
  // createEventTrackMutators — see that factory's doc comment for why this
  // isn't three copies of the same three functions.

  const scaleTrackMutators = createEventTrackMutators<ScaleEvent>(
    () => scaleTrack,
    (next) => {
      scaleTrack = next;
    },
    recordHistory,
    { upsert: 'Set scale marker', remove: 'Remove scale marker', move: 'Move scale marker' },
  );

  const chordTrackMutators = createEventTrackMutators<ChordEvent>(
    () => chordTrack,
    (next) => {
      chordTrack = next;
    },
    recordHistory,
    { upsert: 'Set chord marker', remove: 'Remove chord marker', move: 'Move chord marker' },
  );

  const labelTrackMutators = createEventTrackMutators<LabelEvent>(
    () => labelTrack,
    (next) => {
      labelTrack = next;
    },
    recordHistory,
    { upsert: 'Set label marker', remove: 'Remove label marker', move: 'Move label marker' },
  );

  // ── Arranger track (tracks.md#arranger-track-placeholder) ────────────────
  // Sections span a range rather than a single beat, so they can't reuse
  // createEventTrackMutators above (built for TimelineEvent's beat-keyed
  // collision rule) — each mutator here delegates to arranger.ts's
  // gap-clamping domain functions, only recording history when the result
  // actually differs (those functions return the same array reference for a
  // no-op edit, e.g. dragging a section onto itself).

  function addArrangerSection(beat: number) {
    const next = addSectionAt(arrangerTrack, Math.max(0, beat), totalBeats);
    if (next === arrangerTrack) return;
    recordHistory('Add section');
    arrangerTrack = next;
  }

  function moveArrangerSection(id: string, beat: number) {
    const next = moveSection(arrangerTrack, id, beat, totalBeats);
    if (next === arrangerTrack) return;
    recordHistory('Move section');
    arrangerTrack = next;
  }

  function resizeArrangerSectionStart(id: string, beat: number) {
    const next = resizeSectionStart(arrangerTrack, id, beat);
    if (next === arrangerTrack) return;
    recordHistory('Resize section');
    arrangerTrack = next;
  }

  function resizeArrangerSectionEnd(id: string, beat: number) {
    const next = resizeSectionEnd(arrangerTrack, id, beat, totalBeats);
    if (next === arrangerTrack) return;
    recordHistory('Resize section');
    arrangerTrack = next;
  }

  function updateArrangerSection(id: string, updates: { label: string; color: string }) {
    const next = updateSection(arrangerTrack, id, updates);
    if (next === arrangerTrack) return;
    recordHistory('Rename section');
    arrangerTrack = next;
  }

  function removeArrangerSection(id: string) {
    const next = removeArrangerSectionFromTrack(arrangerTrack, id);
    if (next === arrangerTrack) return;
    recordHistory('Remove section');
    arrangerTrack = next;
  }

  // ── Layers (layers.md) ────────────────────────────────────────────────────
  // Add/remove/rename/reorder/visibility/lock are document mutations — same
  // tier as arranger-section edits above — recorded through history like
  // every other track mutator. setActiveLayer is presentation/working state
  // (layers.md#active-layer) and deliberately isn't.

  function addLayer() {
    recordHistory('Add layer');
    const layer: Layer = {
      id: crypto.randomUUID(),
      name: `Layer ${String(layers.length + 1)}`,
      instrument: structuredClone(DEFAULT_SYNTH),
      color: nextLayerColor(layers),
      visible: true,
      locked: false,
    };
    layers = [layer, ...layers];
    activeLayerId = layer.id;
  }

  /**
   * Removes layer `id` and every note on it, in one history entry — the
   * Photoshop analogy layers.md draws throughout (delete a layer, delete its
   * content). No-ops when `id` is the only layer left: there must always be
   * at least one layer for a new note to land on.
   */
  function removeLayer(id: string) {
    if (layers.length <= 1) return;
    if (!layers.some((l) => l.id === id)) return;
    recordHistory('Remove layer');
    layers = layers.filter((l) => l.id !== id);
    notes = notes.filter((n) => n.layerId !== id);
    pruneSelectionToExistingNotes();
    revalidateActiveLayer();
    disposeLayer(id);
  }

  function renameLayer(id: string, name: string) {
    const layer = layerFor(id);
    if (!layer || layer.name === name) return;
    recordHistory('Rename layer');
    layer.name = name;
  }

  function setLayerVisible(id: string, visible: boolean) {
    const layer = layerFor(id);
    if (!layer || layer.visible === visible) return;
    recordHistory(visible ? 'Show layer' : 'Hide layer');
    layer.visible = visible;
  }

  function setLayerLocked(id: string, locked: boolean) {
    const layer = layerFor(id);
    if (!layer || layer.locked === locked) return;
    recordHistory(locked ? 'Lock layer' : 'Unlock layer');
    layer.locked = locked;
  }

  function moveLayer(id: string, toIndex: number) {
    const next = moveLayerInStack(layers, id, toIndex);
    if (next === layers) return;
    recordHistory('Reorder layers');
    layers = next;
  }

  function setActiveLayer(id: string) {
    if (layerFor(id)) activeLayerId = id;
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
    timeSignatureTrack = entry.timeSignatureEvents;
    scaleTrack = entry.scaleEvents;
    chordTrack = entry.chordEvents;
    labelTrack = entry.labelEvents;
    arrangerTrack = entry.arrangerSections;
    layers = entry.layers;
    pruneSelectionToExistingNotes();
    revalidateActiveLayer();
  }

  function redo() {
    const entry = _history.redo(currentSnapshot);
    syncHistory();
    if (!entry) return;
    notes = entry.notes;
    timeSignatureTrack = entry.timeSignatureEvents;
    scaleTrack = entry.scaleEvents;
    chordTrack = entry.chordEvents;
    labelTrack = entry.labelEvents;
    arrangerTrack = entry.arrangerSections;
    layers = entry.layers;
    pruneSelectionToExistingNotes();
    revalidateActiveLayer();
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

  function executeCommand(commandId: string, params?: Record<string, unknown>) {
    const descriptor = commandRegistry.find((command) => command.id === commandId);
    if (!descriptor) return false;

    const ctx = commandContext;
    if (!descriptor.isApplicable(ctx)) return false;

    const resolvedParams = params ?? {};
    if ('run' in descriptor && descriptor.run) {
      const result = descriptor.run(ctx, resolvedParams);
      applyCommandResult(result);
      return true;
    }

    return false;
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

    /** Backed by tempoTrack[0].bpm (timeline.md) — reads/writes as a plain number, same as before. */
    get tempo() {
      return tempoTrack[0].bpm;
    },
    set tempo(v: number) {
      tempoTrack = [{ ...tempoTrack[0], bpm: v }, ...tempoTrack.slice(1)];
    },

    get tempoTrack() {
      return tempoTrack;
    },

    get timeSignatureTrack() {
      return timeSignatureTrack;
    },

    get scaleTrack() {
      return scaleTrack;
    },

    get chordTrack() {
      return chordTrack;
    },

    get labelTrack() {
      return labelTrack;
    },

    get arrangerTrack() {
      return arrangerTrack;
    },

    get barBeats() {
      return barBeatPositions;
    },

    get beatGroupLines() {
      return beatGroupLinePositions;
    },

    /** The scale active at a given beat (single segment — for the piano-keys column, not a range). */
    activeScaleAt(beat: number) {
      return activeEventAt(scaleTrack, beat);
    },

    /** The chord active at a given beat (single segment — mirrors activeScaleAt above). */
    activeChordAt(beat: number) {
      return activeEventAt(chordTrack, beat);
    },

    /** Proxies the *active layer's* instrument (layers.md) — not a document-wide setting anymore. */
    get synthSettings() {
      return activeLayer()?.instrument ?? DEFAULT_SYNTH;
    },
    set synthSettings(v: SynthSettings) {
      const layer = activeLayer();
      if (layer) layer.instrument = v;
    },

    get layers() {
      return layers;
    },

    get activeLayerId() {
      return activeLayerId;
    },
    set activeLayerId(v: string) {
      setActiveLayer(v);
    },

    layerFor,

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
    executeCommand,
    upsertTimeSignatureEvent: timeSignatureTrackMutators.upsert,
    removeTimeSignatureEvent,
    moveTimeSignatureEvent,
    upsertScaleEvent: scaleTrackMutators.upsert,
    removeScaleEvent: scaleTrackMutators.remove,
    moveScaleEvent: scaleTrackMutators.move,
    upsertChordEvent: chordTrackMutators.upsert,
    removeChordEvent: chordTrackMutators.remove,
    moveChordEvent: chordTrackMutators.move,
    upsertLabelEvent: labelTrackMutators.upsert,
    removeLabelEvent: labelTrackMutators.remove,
    moveLabelEvent: labelTrackMutators.move,
    addArrangerSection,
    moveArrangerSection,
    resizeArrangerSectionStart,
    resizeArrangerSectionEnd,
    updateArrangerSection,
    removeArrangerSection,
    addLayer,
    removeLayer,
    renameLayer,
    setLayerVisible,
    setLayerLocked,
    moveLayer,
  };
}

export type Store = ReturnType<typeof createStore>;
