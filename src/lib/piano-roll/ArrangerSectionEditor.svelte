<script lang="ts">
  import type { ArrangerSection } from './arranger.js';
  import { SECTION_COLORS } from './arranger.js';

  interface Props {
    section: ArrangerSection;
    onSave: (label: string, color: string) => void;
    onDelete: () => void;
  }

  const { section, onSave, onDelete }: Props = $props();

  // Writable $derived (re-syncs whenever `section` changes identity — the
  // parent re-targets this editor at a different section — while staying
  // locally editable via the bindings below).
  let label = $derived(section.label);
  let color = $derived(section.color);
</script>

<div class="section-editor">
  <div class="beat-readout">Beats {section.startBeat}–{section.endBeat}</div>

  <div class="field">
    <label class="field-label" for="section-label">Label</label>
    <input id="section-label" class="text-input" type="text" bind:value={label} />
  </div>

  <div class="field">
    <span class="field-label" id="section-color-label">Color</span>
    <div class="swatches" role="radiogroup" aria-labelledby="section-color-label">
      {#each SECTION_COLORS as swatch (swatch)}
        <button
          type="button"
          class="swatch"
          class:selected={color === swatch}
          style="background: {swatch};"
          role="radio"
          aria-checked={color === swatch}
          aria-label="Color {swatch}"
          onclick={() => {
            color = swatch;
          }}
        ></button>
      {/each}
    </div>
  </div>

  <div class="actions">
    <button
      type="button"
      class="save-btn"
      disabled={label.trim().length === 0}
      onclick={() => {
        onSave(label.trim(), color);
      }}
    >
      Update section
    </button>
    <button type="button" class="delete-btn" onclick={onDelete}> Delete section </button>
  </div>
</div>

<style>
  .section-editor {
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

  .text-input {
    width: 100%;
    padding: 5px 8px;
    background: #0d0d1c;
    border: 1px solid #2a2a45;
    border-radius: 5px;
    color: #c0c0e0;
    font-size: 13px;
    box-sizing: border-box;
  }

  .text-input:focus {
    outline: 1px solid #6b6bd9;
  }

  .swatches {
    display: flex;
    gap: 8px;
  }

  .swatch {
    width: 26px;
    height: 26px;
    border-radius: 6px;
    border: 2px solid transparent;
    cursor: pointer;
    padding: 0;
  }

  .swatch.selected {
    border-color: #f0f0ff;
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

  .save-btn:hover:not(:disabled) {
    background: #7878e8;
  }

  .save-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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
