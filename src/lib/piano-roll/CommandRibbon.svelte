<script lang="ts">
  import { getEditorState } from './context.svelte.js';
  import { commandRegistry } from './commands/index.js';

  const { store } = getEditorState();

  let activeTab = $state<'transform' | 'generate'>('transform');
  let drawerOpen = $state(false);
  let activeCommandId = $state<string | null>(null);
  let params = $state<Record<string, unknown>>({});

  function updateParamValue(fieldKey: string, value: unknown) {
    params = { ...params, [fieldKey]: value };
  }

  const tabs = [
    { id: 'transform', label: 'Transform' },
    { id: 'generate', label: 'Generate' },
  ] as const;

  const commandsByCategory = {
    transform: commandRegistry.filter((command) => command.category === 'transform'),
    generate: commandRegistry.filter((command) => command.category === 'generate'),
  } satisfies Record<'transform' | 'generate', typeof commandRegistry>;

  function openCommand(commandId: string) {
    const descriptor = commandRegistry.find((command) => command.id === commandId);
    if (!descriptor) return;

    activeCommandId = commandId;
    params = Object.fromEntries(
      (descriptor.params ?? []).map((field) => [field.key, field.default]),
    );
    drawerOpen = descriptor.params?.length ? true : false;

    if (!descriptor.params?.length) {
      void store.executeCommand(commandId);
    }
  }

  function runActiveCommand() {
    if (!activeCommandId) return;
    const executed = store.executeCommand(activeCommandId, params);
    if (executed) {
      drawerOpen = false;
    }
  }
</script>

<div class="ribbon" role="toolbar" aria-label="Command ribbon">
  <div class="tabs" role="tablist" aria-label="Ribbon tabs">
    {#each tabs as tab (tab.id)}
      <button
        class="tab"
        role="tab"
        aria-selected={activeTab === tab.id}
        class:active={activeTab === tab.id}
        onclick={() => {
          activeTab = tab.id;
        }}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  <div class="groups">
    {#each commandsByCategory[activeTab] as command (command.id)}
      {@const isApplicable = command.isApplicable(store.commandContext)}
      <div class="group">
        <button
          class="command-btn"
          onclick={() => {
            openCommand(command.id);
          }}
          disabled={!isApplicable}
        >
          <span class="icon">{command.icon}</span>
          <span>{command.id}</span>
        </button>
      </div>
    {/each}
  </div>
</div>

{#if drawerOpen && activeCommandId}
  <button
    class="drawer-backdrop"
    type="button"
    onclick={() => (drawerOpen = false)}
    aria-label="Close command drawer"
  ></button>
  <aside class="drawer" aria-label="Command parameters">
    <div class="drawer-header">
      <strong>{activeCommandId}</strong>
      <button onclick={() => (drawerOpen = false)}>Close</button>
    </div>

    {#each commandRegistry.find((command) => command.id === activeCommandId)?.params ?? [] as field (field.key)}
      <label class="field">
        <span>{field.label}</span>
        {#if field.type === 'number'}
          <input
            type="number"
            value={typeof params[field.key] === 'number' ? params[field.key] : field.default}
            oninput={(event) => {
              updateParamValue(field.key, Number(event.currentTarget.value));
            }}
            min={field.min}
            max={field.max}
            step={field.step}
          />
        {:else if field.type === 'range'}
          <input
            type="range"
            value={typeof params[field.key] === 'number' ? params[field.key] : field.default}
            oninput={(event) => {
              updateParamValue(field.key, Number(event.currentTarget.value));
            }}
            min={field.min}
            max={field.max}
            step={field.step}
          />
        {:else if field.type === 'select'}
          <select
            value={typeof params[field.key] === 'string' ? params[field.key] : field.default}
            onchange={(event) => {
              updateParamValue(field.key, event.currentTarget.value);
            }}
          >
            {#each field.options as option (option.value)}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        {:else if field.type === 'boolean'}
          {@const rawValue = params[field.key]}
          {@const checkedValue: boolean = typeof rawValue === 'boolean' ? rawValue : field.default}
          <input
            type="checkbox"
            checked={checkedValue}
            onchange={(event) => {
              updateParamValue(field.key, event.currentTarget.checked);
            }}
          />
        {:else if field.type === 'number-range'}
          {@const currentRange =
            typeof params[field.key] === 'object' && params[field.key] !== null
              ? (params[field.key] as { min: number; max: number })
              : field.default}
          <div class="range-pair">
            <input
              type="number"
              value={currentRange.min}
              oninput={(event) => {
                const next = {
                  ...currentRange,
                  min: Number(event.currentTarget.value),
                };
                updateParamValue(field.key, next);
              }}
              min={field.min}
              max={field.max}
              step={field.step}
            />
            <input
              type="number"
              value={currentRange.max}
              oninput={(event) => {
                const next = {
                  ...currentRange,
                  max: Number(event.currentTarget.value),
                };
                updateParamValue(field.key, next);
              }}
              min={field.min}
              max={field.max}
              step={field.step}
            />
          </div>
        {/if}
      </label>
    {/each}

    <button class="run-btn" onclick={runActiveCommand}>Run</button>
  </aside>
{/if}

<style>
  .ribbon {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    background: #161628;
    border-bottom: 1px solid #292944;
  }

  .tabs {
    display: flex;
    gap: 8px;
  }

  .tab {
    border: 1px solid #33334d;
    background: #202036;
    color: #d9d9f2;
    border-radius: 999px;
    padding: 4px 10px;
    cursor: pointer;
  }

  .tab.active {
    background: #6a6ad8;
    border-color: #8b8be8;
  }

  .groups {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .group {
    display: flex;
  }

  .command-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid #313148;
    background: #23233a;
    color: #f2f2ff;
    border-radius: 8px;
    padding: 6px 10px;
    cursor: pointer;
  }

  .command-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .drawer-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 30;
  }

  .drawer {
    position: fixed;
    top: 0;
    right: 0;
    width: min(360px, 88vw);
    height: 100%;
    background: #121221;
    color: #f0f0ff;
    z-index: 31;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-shadow: -6px 0 24px rgba(0, 0, 0, 0.35);
  }

  .drawer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field input,
  .field select {
    width: 100%;
    border: 1px solid #33334d;
    background: #1c1c2d;
    color: #f0f0ff;
    border-radius: 6px;
    padding: 6px 8px;
  }

  .range-pair {
    display: flex;
    gap: 8px;
  }

  .run-btn {
    margin-top: auto;
    padding: 8px 10px;
    border: 0;
    border-radius: 8px;
    background: #6a6ad8;
    color: white;
    cursor: pointer;
  }
</style>
