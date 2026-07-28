<script lang="ts">
  import { MediaQuery } from 'svelte/reactivity';
  import { COMMAND_LABELS } from './command-metadata.js';
  import { commandRegistry } from './commands/index.js';
  import type { CommandDescriptor } from './commands/types.js';
  import { getEditorState } from './context.svelte.js';
  import OverlayShell from './OverlayShell.svelte';
  import RibbonPanel from './RibbonPanel.svelte';

  const { store, ribbonUi } = getEditorState();

  // Matches ribbon.md's mobile breakpoint: collapsed behind a toggle that
  // opens the ribbon as a bottom sheet, vs. always-visible inline on
  // tablet/desktop.
  const isMobile = new MediaQuery('max-width: 599px');

  // Owned here (rather than in RibbonPanel) so the params drawer survives
  // RibbonPanel unmounting — openCommand closes the mobile ribbon sheet to
  // reveal the drawer, which would otherwise destroy this state.
  let activeCommandId = $state<string | null>(null);
  let params = $state<Record<string, unknown>>({});

  const activeCommand = $derived(
    activeCommandId ? (commandRegistry.find((c) => c.id === activeCommandId) ?? null) : null,
  );

  function updateParamValue(fieldKey: string, value: unknown) {
    params = { ...params, [fieldKey]: value };
  }

  function openCommand(command: CommandDescriptor) {
    if (!command.params?.length) {
      void store.executeCommand(command.id);
      return;
    }

    activeCommandId = command.id;
    params = Object.fromEntries((command.params ?? []).map((field) => [field.key, field.default]));
    ribbonUi.paramsDrawerOpen = true;
    if (isMobile.current) ribbonUi.ribbonOpen = false;
  }

  function closeParamsDrawer() {
    ribbonUi.paramsDrawerOpen = false;
  }

  function runActiveCommand() {
    if (!activeCommandId) return;
    const executed = store.executeCommand(activeCommandId, params);
    if (executed) closeParamsDrawer();
  }
</script>

{#if isMobile.current}
  <OverlayShell
    open={ribbonUi.ribbonOpen}
    title="Commands"
    onclose={() => (ribbonUi.ribbonOpen = false)}
  >
    <RibbonPanel sheet onOpenCommand={openCommand} />
  </OverlayShell>
{:else if ribbonUi.ribbonOpen}
  <RibbonPanel onOpenCommand={openCommand} />
{/if}

<OverlayShell
  open={ribbonUi.paramsDrawerOpen && activeCommand !== null}
  title={activeCommand ? (COMMAND_LABELS[activeCommand.id] ?? activeCommand.id) : 'Command'}
  onclose={closeParamsDrawer}
>
  {#if activeCommand}
    <div class="params-form">
      {#each activeCommand.params ?? [] as field (field.key)}
        {#if !field.showIf || field.showIf(params)}
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
              <div class="range-row">
                <input
                  class="slider"
                  type="range"
                  value={typeof params[field.key] === 'number' ? params[field.key] : field.default}
                  oninput={(event) => {
                    updateParamValue(field.key, Number(event.currentTarget.value));
                  }}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                />
                <span class="range-value"
                  >{typeof params[field.key] === 'number' ? params[field.key] : field.default}</span
                >
              </div>
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
              {@const checkedValue = typeof rawValue === 'boolean' ? rawValue : field.default}
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
                    updateParamValue(field.key, {
                      ...currentRange,
                      min: Number(event.currentTarget.value),
                    });
                  }}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                />
                <span class="range-pair-sep">to</span>
                <input
                  type="number"
                  value={currentRange.max}
                  oninput={(event) => {
                    updateParamValue(field.key, {
                      ...currentRange,
                      max: Number(event.currentTarget.value),
                    });
                  }}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                />
              </div>
            {/if}
          </label>
        {/if}
      {/each}

      <button class="run-btn" onclick={runActiveCommand}>Apply</button>
    </div>
  {/if}
</OverlayShell>

<style>
  /* ── Params form ── */
  .params-form {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 14px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12px;
    color: #9090c0;
  }

  .field input,
  .field select {
    width: 100%;
    border: 1px solid #2a2a45;
    background: #0d0d1c;
    color: #f0f0ff;
    border-radius: 6px;
    padding: 6px 8px;
    font-size: 13px;
  }

  .field input:focus,
  .field select:focus {
    outline: 1px solid #6b6bd9;
  }

  .range-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .slider {
    flex: 1;
    accent-color: #6b6bd9;
  }

  .range-value {
    font-size: 12px;
    color: #c0c0e0;
    min-width: 28px;
    text-align: right;
  }

  .range-pair {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .range-pair-sep {
    font-size: 11px;
    color: #666888;
  }

  .run-btn {
    margin-top: 6px;
    padding: 9px 10px;
    border: 0;
    border-radius: 8px;
    background: #6b6bd9;
    color: white;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.12s;
  }

  .run-btn:hover {
    background: #7c7ce8;
  }
</style>
