<script lang="ts">
  import { getEditorState } from './context.svelte.js';
  const { store } = getEditorState();
  import { pitchClassesForChordEvent, pitchClassesForScaleEvent } from '../music-theory/index.js';
  import { auditionNote } from './audio.js';
  import { isBlackKey, noteName, MAX_MIDI, NOTE_COUNT } from './types.js';

  // Notes displayed from high (top) to low (bottom)
  const noteRange = Array.from({ length: NOTE_COUNT }, (_, i) => MAX_MIDI - i);

  // In-scale highlighting uses the scale active at the current playhead — a
  // single segment, since (unlike the note grid) this column isn't tied to a
  // scrollable beat range (tracks.md#piano-keys-column).
  const scaleDegrees = $derived.by(() => {
    const active = store.activeScaleAt(store.currentBeat);
    return active ? pitchClassesForScaleEvent(active.root, active.mode) : new Set<number>();
  });

  // Chord-tone highlighting mirrors the scale-degree one above, using the
  // chord active at the same single playhead position (tracks.md).
  const chordTones = $derived.by(() => {
    const active = store.activeChordAt(store.currentBeat);
    return active ? pitchClassesForChordEvent(active.root, active.quality) : new Set<number>();
  });

  const activeNotes = $derived(
    store.isPlaying
      ? new Set(
          store.notes
            .filter(
              (n) =>
                n.startBeat <= store.currentBeat &&
                n.startBeat + n.durationBeats > store.currentBeat,
            )
            .map((n) => n.midiNote),
        )
      : new Set<number>(),
  );

  const totalHeight = $derived(NOTE_COUNT * store.rowHeight);
</script>

<div
  class="piano-keys"
  style="width: 64px; height: {totalHeight}px; position: sticky; left: 0; z-index: 10; flex-shrink: 0;"
>
  {#each noteRange as midi (midi)}
    {@const black = isBlackKey(midi)}
    {@const isC = midi % 12 === 0}
    {@const active = activeNotes.has(midi)}
    {@const inScale = scaleDegrees.has(midi % 12)}
    {@const inChord = chordTones.has(midi % 12)}
    {@const isTension = inChord && !inScale}
    <button
      class="key"
      class:black-key={black}
      class:white-key={!black}
      class:c-note={isC}
      class:in-scale={inScale}
      class:in-chord={inChord}
      class:tension={isTension}
      class:active
      style="height: {store.rowHeight}px;"
      onclick={() => {
        auditionNote(midi, store.synthSettings);
      }}
      aria-label={noteName(midi)}
    >
      <span class="label">{noteName(midi)}</span>
    </button>
  {/each}
</div>

<style>
  .piano-keys {
    background: #111120;
    border-right: 1px solid #2a2a45;
    overflow: hidden;
  }

  .key {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    width: 100%;
    padding: 0 5px;
    border: none;
    border-bottom: 1px solid #1a1a2e;
    cursor: pointer;
    box-sizing: border-box;
    transition: background 0.07s;
  }

  .white-key {
    background: #1e1e34;
    color: #6666aa;
  }

  .black-key {
    background: #0d0d1c;
    color: #444466;
  }

  .c-note {
    border-top: 1px solid #3a3a60;
  }

  /* ── In-scale highlighting at the playhead (tracks.md) — advisory only ── */
  .key.in-scale {
    box-shadow: inset 3px 0 0 var(--color-scale-degree, #38bdf8);
  }

  /* ── Chord-tone highlighting (tracks.md) — layered on top of in-scale via a
     thicker inset, so a chord tone stands out from a merely-in-scale key.
     A tension tone (outside the active scale) gets a distinct color. ── */
  .key.in-chord {
    box-shadow: inset 5px 0 0 var(--color-chord-tone, #facc15);
  }

  .key.in-chord.tension {
    box-shadow: inset 5px 0 0 var(--color-chord-tension, #fb7185);
  }

  .key.active,
  .key:hover {
    background: #5555c0;
    color: #fff;
  }

  .label {
    font-size: 9px;
    font-family: 'Courier New', monospace;
    pointer-events: none;
    white-space: nowrap;
  }
</style>
