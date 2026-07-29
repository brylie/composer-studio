<script lang="ts">
  import { commonTimeSignatures } from '../music-theory/index.js';
  import type { TimeSignatureEvent } from './timeline.js';

  // v1: a fixed preset picker, not free-form numerator/denominator entry
  // (tracks.md#v1-preset-picker-not-free-form-entry) — sourced from the
  // music-theory adapter's tonal.js-backed preset list, not hand-rolled here.
  const PRESETS = commonTimeSignatures();

  interface Props {
    beat: number;
    existing: TimeSignatureEvent | null;
    onSave: (event: TimeSignatureEvent) => void;
    onDelete: (id: string) => void;
  }

  const { beat, existing, onSave, onDelete }: Props = $props();

  // Writable $derived: re-syncs whenever `existing` changes identity — same
  // pattern as ScaleEventEditor/ChordEventEditor — while staying locally
  // selectable via the preset buttons below.
  let numerator = $derived(existing?.numerator ?? 4);
  let denominator = $derived(existing?.denominator ?? 4);

  function selectPreset(preset: { numerator: number; denominator: number }) {
    numerator = preset.numerator;
    denominator = preset.denominator;
  }
</script>

<div class="time-signature-editor">
  <div class="beat-readout">Beat {beat}</div>

  <div class="field">
    <span class="field-label">Time signature</span>
    <div class="preset-grid" role="group" aria-label="Time signature preset">
      {#each PRESETS as preset (preset.label)}
        <button
          type="button"
          class="preset-btn"
          class:selected={preset.numerator === numerator && preset.denominator === denominator}
          onclick={() => {
            selectPreset(preset);
          }}
        >
          {preset.label}
        </button>
      {/each}
    </div>
  </div>

  <div class="actions">
    <button
      type="button"
      class="save-btn"
      onclick={() => {
        onSave({ id: existing?.id ?? crypto.randomUUID(), beat, numerator, denominator });
      }}
    >
      {existing ? 'Update marker' : 'Add marker'}
    </button>
    {#if existing && beat !== 0}
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
  .time-signature-editor {
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

  .preset-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }

  .preset-btn {
    padding: 8px 4px;
    background: #0d0d1c;
    border: 1px solid #2a2a45;
    border-radius: 5px;
    color: #c0c0e0;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition:
      background 0.12s,
      border-color 0.12s;
  }

  .preset-btn:hover {
    border-color: #6b6bd9;
  }

  .preset-btn.selected {
    background: #2e2e58;
    border-color: #8f8fff;
    color: #fff;
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
