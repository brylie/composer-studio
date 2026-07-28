<script lang="ts">
  import type { LabelEvent } from './timeline.js';

  interface Props {
    beat: number;
    existing: LabelEvent | null;
    onSave: (event: LabelEvent) => void;
    onDelete: (id: string) => void;
  }

  const { beat, existing, onSave, onDelete }: Props = $props();

  // Writable $derived (re-syncs whenever `existing` changes identity, but
  // stays locally editable via bind:value below) — a single field doesn't
  // need the $state+$effect resync pattern ScaleEventEditor/ChordEventEditor
  // use for their two fields.
  let text = $derived(existing?.text ?? '');
</script>

<div class="label-editor">
  <div class="beat-readout">Beat {beat}</div>

  <div class="field">
    <label class="field-label" for="label-text">Text</label>
    <input
      id="label-text"
      class="text-input"
      type="text"
      placeholder="e.g. Solo starts here"
      bind:value={text}
    />
  </div>

  <div class="actions">
    <button
      type="button"
      class="save-btn"
      disabled={text.trim().length === 0}
      onclick={() => {
        onSave({ id: existing?.id ?? crypto.randomUUID(), beat, text: text.trim() });
      }}
    >
      {existing ? 'Update label' : 'Add label'}
    </button>
    {#if existing}
      <button
        type="button"
        class="delete-btn"
        onclick={() => {
          onDelete(existing.id);
        }}
      >
        Delete label
      </button>
    {/if}
  </div>
</div>

<style>
  .label-editor {
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
