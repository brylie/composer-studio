<script lang="ts">
  import type { ChordEvent } from './timeline.js';

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

  // A curated set of tonal.js chord symbols (libraries.md) — common triads,
  // sevenths, and the sus/add/6 variants a harmony-focused user reaches for
  // most often. Every `value` here is a real @tonaljs/chord quality symbol
  // (verified against the installed tonal version, not guessed) —
  // pitchClassesForChordEvent (music-theory/index.ts) resolves it to the
  // actual pitch classes chord-tone highlighting and generate-chords need.
  const QUALITY_GROUPS = [
    {
      label: 'Triads',
      qualities: [
        { value: 'maj', label: 'Major' },
        { value: 'min', label: 'Minor' },
        { value: 'dim', label: 'Diminished' },
        { value: 'aug', label: 'Augmented' },
      ],
    },
    {
      label: 'Sevenths',
      qualities: [
        { value: 'maj7', label: 'Major 7th' },
        { value: '7', label: 'Dominant 7th' },
        { value: 'm7', label: 'Minor 7th' },
        { value: 'm7b5', label: 'Half-diminished 7th' },
        { value: 'dim7', label: 'Diminished 7th' },
      ],
    },
    {
      label: 'Extended & suspended',
      qualities: [
        { value: '6', label: 'Major 6th' },
        { value: 'm6', label: 'Minor 6th' },
        { value: '9', label: 'Dominant 9th' },
        { value: 'maj9', label: 'Major 9th' },
        { value: 'm9', label: 'Minor 9th' },
        { value: 'add9', label: 'Add 9' },
        { value: 'sus2', label: 'Sus2' },
        { value: 'sus4', label: 'Sus4' },
      ],
    },
  ] as const;

  interface Props {
    beat: number;
    existing: ChordEvent | null;
    onSave: (event: ChordEvent) => void;
    onDelete: (id: string) => void;
  }

  const { beat, existing, onSave, onDelete }: Props = $props();

  // Writable $derived: re-syncs whenever `existing` changes identity (covers
  // both initial mount and the parent re-targeting this editor at a
  // different marker or a fresh beat), while staying locally editable via
  // the bind:value bindings below.
  let root = $derived(existing?.root ?? 0);
  let quality = $derived(existing?.quality ?? 'maj');
</script>

<div class="chord-editor">
  <div class="beat-readout">Beat {beat}</div>

  <div class="field">
    <label class="field-label" for="chord-root">Root</label>
    <select id="chord-root" class="select" bind:value={root}>
      {#each NOTE_NAMES as name, i (name)}
        <option value={i}>{name}</option>
      {/each}
    </select>
  </div>

  <div class="field">
    <label class="field-label" for="chord-quality">Quality</label>
    <select id="chord-quality" class="select" bind:value={quality}>
      {#each QUALITY_GROUPS as group (group.label)}
        <optgroup label={group.label}>
          {#each group.qualities as q (q.value)}
            <option value={q.value}>{q.label}</option>
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
        onSave({ id: existing?.id ?? crypto.randomUUID(), beat, root, quality });
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
  .chord-editor {
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
