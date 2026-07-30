<script lang="ts">
  // The generator browser (generators.md §7.4): starter generators only in
  // V1 (modules are inserted from the inspector's own "Add module" control,
  // not from here). Dropping/selecting a starter creates a new session.
  import { GENERATOR_DESCRIPTIONS, GENERATOR_LABELS } from './command-metadata.js';
  import { generatorCatalog } from './generators/catalog.js';
  import type { GeneratorDescriptor } from './generators/types.js';
  import Icon from './Icon.svelte';

  interface Props {
    onSelect: (descriptor: GeneratorDescriptor) => void;
  }

  const { onSelect }: Props = $props();
</script>

<div class="generator-browser">
  {#each generatorCatalog as descriptor (descriptor.id)}
    <button
      type="button"
      class="generator-item"
      onclick={() => {
        onSelect(descriptor);
      }}
    >
      <span class="generator-icon"><Icon name={descriptor.icon} size={18} /></span>
      <span class="generator-text">
        <span class="generator-label">{GENERATOR_LABELS[descriptor.id] ?? descriptor.id}</span>
        <span class="generator-family">{descriptor.family}</span>
        {#if GENERATOR_DESCRIPTIONS[descriptor.id]}
          <span class="generator-description">{GENERATOR_DESCRIPTIONS[descriptor.id]}</span>
        {/if}
      </span>
    </button>
  {/each}
</div>

<style>
  .generator-browser {
    display: flex;
    flex-direction: column;
    padding: 8px;
    gap: 4px;
  }

  .generator-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px;
    border: 1px solid #2a2a45;
    border-radius: 8px;
    background: #1a1a2c;
    color: #e0e0f0;
    text-align: left;
    cursor: pointer;
  }

  .generator-item:hover {
    background: #232342;
    border-color: #3a3a60;
  }

  .generator-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    flex-shrink: 0;
    border-radius: 6px;
    background: #262640;
    color: #b0b0e8;
  }

  .generator-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .generator-label {
    font-size: 13px;
    font-weight: 700;
  }

  .generator-family {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #7070a0;
  }

  .generator-description {
    font-size: 11px;
    color: #9090c0;
  }
</style>
