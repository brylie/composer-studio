<script lang="ts">
  import type { ScaleEvent } from './timeline.js';

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

  // A curated set of tonal.js scale names (libraries.md), grouped for the
  // picker — the common church modes and minor variants, plus pentatonic/
  // blues and a handful of "exotic" (non-diatonic, non-Western) scales to
  // show the scale track isn't limited to the seven-note default. Every
  // `value` here is a real @tonaljs/scale name — verified against the
  // installed tonal version, not guessed.
  const MODE_GROUPS = [
    {
      label: 'Modes',
      modes: [
        { value: 'major', label: 'Major (Ionian)' },
        { value: 'dorian', label: 'Dorian' },
        { value: 'phrygian', label: 'Phrygian' },
        { value: 'lydian', label: 'Lydian' },
        { value: 'mixolydian', label: 'Mixolydian' },
        { value: 'aeolian', label: 'Minor (Aeolian)' },
        { value: 'locrian', label: 'Locrian' },
      ],
    },
    {
      label: 'Minor variants',
      modes: [
        { value: 'harmonic minor', label: 'Harmonic Minor' },
        { value: 'melodic minor', label: 'Melodic Minor' },
      ],
    },
    {
      label: 'Pentatonic & blues',
      modes: [
        { value: 'major pentatonic', label: 'Major Pentatonic' },
        { value: 'minor pentatonic', label: 'Minor Pentatonic' },
        { value: 'blues', label: 'Blues' },
      ],
    },
    {
      label: 'Exotic',
      modes: [
        { value: 'whole tone', label: 'Whole Tone' },
        { value: 'hungarian minor', label: 'Hungarian Minor' },
        { value: 'phrygian dominant', label: 'Phrygian Dominant' },
        { value: 'double harmonic major', label: 'Double Harmonic Major' },
        { value: 'hirajoshi', label: 'Hirajoshi' },
        { value: 'enigmatic', label: 'Enigmatic' },
      ],
    },
  ] as const;

  interface Props {
    beat: number;
    existing: ScaleEvent | null;
    onSave: (event: ScaleEvent) => void;
    onDelete: (id: string) => void;
  }

  const { beat, existing, onSave, onDelete }: Props = $props();

  // Writable $derived: re-syncs whenever `existing` changes identity — covers
  // both the initial mount and the parent re-targeting this editor at a
  // different marker (or a fresh beat) — while staying locally editable via
  // the bind:value bindings below.
  let root = $derived(existing?.root ?? 0);
  let mode = $derived(existing?.mode ?? 'major');
</script>

<div class="scale-editor">
  <div class="beat-readout">Beat {beat}</div>

  <div class="field">
    <label class="field-label" for="scale-root">Root</label>
    <select id="scale-root" class="select" bind:value={root}>
      {#each NOTE_NAMES as name, i (name)}
        <option value={i}>{name}</option>
      {/each}
    </select>
  </div>

  <div class="field">
    <label class="field-label" for="scale-mode">Scale</label>
    <select id="scale-mode" class="select" bind:value={mode}>
      {#each MODE_GROUPS as group (group.label)}
        <optgroup label={group.label}>
          {#each group.modes as m (m.value)}
            <option value={m.value}>{m.label}</option>
          {/each}
        </optgroup>
      {/each}
    </select>
  </div>

  <div class="actions">
    <button
      type="button"
      class="save-btn"
      onclick={() => {
        onSave({ id: existing?.id ?? crypto.randomUUID(), beat, root, mode });
      }}
    >
      {existing ? 'Update marker' : 'Add marker'}
    </button>
    {#if existing}
      <button
        type="button"
        class="delete-btn"
        onclick={() => {
          onDelete(existing.id);
        }}
      >
        Delete marker
      </button>
    {/if}
  </div>
</div>

<style>
  .scale-editor {
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .beat-readout {
    font-size: 11px;
    color: #888aaa;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field-label {
    font-size: 11px;
    color: #888aaa;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .select {
    width: 100%;
    padding: 5px 8px;
    background: #0d0d1c;
    border: 1px solid #2a2a45;
    border-radius: 5px;
    color: #c0c0e0;
    font-size: 13px;
    cursor: pointer;
  }

  .select:focus {
    outline: 1px solid #6b6bd9;
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 4px;
  }

  .save-btn,
  .delete-btn {
    padding: 8px 12px;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.12s;
  }

  .save-btn {
    background: #6b6bd9;
    color: #fff;
  }

  .save-btn:hover {
    background: #7878e8;
  }

  .delete-btn {
    background: transparent;
    border: 1px solid #4a2a2a;
    color: #ef8080;
  }

  .delete-btn:hover {
    background: #2a1414;
  }
</style>
