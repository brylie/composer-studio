<script lang="ts">
  // Quick-apply (direct-manipulation.md): one flat, searchable list spanning
  // both commandRegistry and generatorCatalog, filtered to whatever is
  // isApplicable(ctx) for the current selection. Selecting an entry runs it
  // immediately with default params — no drawer, no session UI — the third
  // invocation path direct-manipulation.md adds alongside "one-click
  // command" and "open the full session".
  import {
    COMMAND_DESCRIPTIONS,
    COMMAND_LABELS,
    GENERATOR_DESCRIPTIONS,
    GENERATOR_LABELS,
  } from './command-metadata.js';
  import { commandRegistry } from './commands/index.js';
  import { getEditorState } from './context.svelte.js';
  import { generatorCatalog } from './generators/catalog.js';
  import Icon from './Icon.svelte';

  interface Props {
    /** Called after an entry is successfully applied, so the caller can close the overlay. */
    onApplied: () => void;
  }

  const { onApplied }: Props = $props();

  const { store } = getEditorState();

  interface QuickApplyEntry {
    kind: 'command' | 'generator';
    id: string;
    label: string;
    description?: string;
    icon: string;
    disabled: boolean;
    disabledReason?: string;
  }

  const ctx = $derived(store.commandContext);
  const sessionActive = $derived(store.generatorSession !== null);

  const entries = $derived.by((): QuickApplyEntry[] => [
    ...commandRegistry
      .filter((command) => typeof command.run === 'function')
      .map((command) => {
        const applicable = command.isApplicable(ctx);
        return {
          kind: 'command' as const,
          id: command.id,
          label: COMMAND_LABELS[command.id] ?? command.id,
          description: COMMAND_DESCRIPTIONS[command.id],
          icon: command.icon,
          disabled: !applicable,
          disabledReason: applicable ? undefined : 'Not available for this selection',
        };
      }),
    ...generatorCatalog.map((descriptor) => {
      const applicable = descriptor.isApplicable(ctx);
      return {
        kind: 'generator' as const,
        id: descriptor.id,
        label: GENERATOR_LABELS[descriptor.id] ?? descriptor.id,
        description: GENERATOR_DESCRIPTIONS[descriptor.id],
        icon: descriptor.icon,
        disabled: !applicable || sessionActive,
        disabledReason: sessionActive
          ? 'Apply or cancel the active generator session first'
          : applicable
            ? undefined
            : 'Not available for this selection',
      };
    }),
  ]);

  let query = $state('');
  let activeIndex = $state(0);

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (entry) =>
        entry.label.toLowerCase().includes(q) ||
        (entry.description ?? '').toLowerCase().includes(q),
    );
  });

  // .at() (unlike index access) types as `T | undefined` regardless of
  // tsconfig's noUncheckedIndexedAccess, so activeEntry stays correctly
  // nullable when `filtered` is empty instead of eslint treating every
  // downstream truthy check on it as dead code.
  const activeEntry = $derived(filtered.at(Math.min(activeIndex, filtered.length - 1)) ?? null);

  let failureMessage = $state<string | null>(null);

  function apply(entry: QuickApplyEntry) {
    if (entry.disabled) return;
    failureMessage = null;
    const applied =
      entry.kind === 'command'
        ? store.quickApplyCommand(entry.id)
        : store.quickApplyGenerator(entry.id);
    if (applied) {
      onApplied();
      return;
    }
    if (entry.kind === 'generator') {
      const errors = store.generatorDiagnostics.filter((d) => d.level === 'error');
      failureMessage =
        errors.map((d) => d.message).join(' ') || `${entry.label} could not be applied.`;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeIndex = Math.min(activeIndex + 1, filtered.length - 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (activeEntry) apply(activeEntry);
    }
    // Escape isn't handled here — it bubbles to OverlayShell's own listener.
  }
</script>

<div class="quick-apply">
  <label class="search-field">
    <Icon name="search" />
    <input
      type="text"
      role="combobox"
      aria-label="Quick apply command or generator"
      aria-expanded="true"
      aria-controls="quick-apply-listbox"
      aria-autocomplete="list"
      aria-activedescendant={activeEntry
        ? `quick-apply-option-${activeEntry.kind}-${activeEntry.id}`
        : undefined}
      placeholder={ctx.count > 0
        ? `Quick apply to ${String(ctx.count)} selected note${ctx.count === 1 ? '' : 's'}…`
        : 'Select notes to quick-apply an operation'}
      value={query}
      oninput={(event) => {
        query = event.currentTarget.value;
        activeIndex = 0;
        failureMessage = null;
      }}
      onkeydown={handleKeydown}
    />
  </label>

  {#if failureMessage}
    <p class="failure" role="alert">{failureMessage}</p>
  {/if}

  <div
    class="results"
    id="quick-apply-listbox"
    role="listbox"
    aria-label="Quick-apply commands and generators"
  >
    {#each filtered as entry (entry.kind + ':' + entry.id)}
      <button
        type="button"
        id="quick-apply-option-{entry.kind}-{entry.id}"
        role="option"
        tabindex="-1"
        aria-selected={entry === activeEntry}
        class="result"
        class:active={entry === activeEntry}
        disabled={entry.disabled}
        title={entry.disabledReason}
        onclick={() => {
          apply(entry);
        }}
        onpointerenter={() => {
          activeIndex = filtered.indexOf(entry);
        }}
      >
        <span class="result-icon"><Icon name={entry.icon} size={16} /></span>
        <span class="result-text">
          <span class="result-label">{entry.label}</span>
          {#if entry.disabled && entry.disabledReason}
            <span class="result-description reason">{entry.disabledReason}</span>
          {:else if entry.description}
            <span class="result-description">{entry.description}</span>
          {/if}
        </span>
        <span class="result-kind">{entry.kind === 'generator' ? 'Generator' : 'Transform'}</span>
      </button>
    {:else}
      <p class="empty">No matching command or generator.</p>
    {/each}
  </div>
</div>

<style>
  .quick-apply {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .search-field {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid #252540;
    color: #7070a0;
    flex-shrink: 0;
  }

  .search-field input {
    flex: 1;
    border: none;
    background: transparent;
    color: #f0f0ff;
    font-size: 14px;
    outline: none;
  }

  .search-field input::placeholder {
    color: #666888;
  }

  .failure {
    margin: 0;
    padding: 8px 14px;
    font-size: 12px;
    color: #d09090;
    border-bottom: 1px solid #252540;
    flex-shrink: 0;
  }

  .results {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px;
    overflow-y: auto;
  }

  .result {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: #e0e0f0;
    text-align: left;
    cursor: pointer;
  }

  .result:hover:not(:disabled) {
    background: #202038;
  }

  .result.active {
    background: #232342;
    border-color: #3a3a60;
  }

  .result:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .result-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    border-radius: 6px;
    background: #262640;
    color: #b0b0e8;
  }

  .result-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    flex: 1;
  }

  .result-label {
    font-size: 13px;
    font-weight: 600;
  }

  .result-description {
    font-size: 11px;
    color: #9090c0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .result-description.reason {
    color: #d09090;
  }

  .result-kind {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #666888;
    flex-shrink: 0;
  }

  .empty {
    padding: 14px 10px;
    font-size: 12px;
    color: #7070a0;
    text-align: center;
  }
</style>
