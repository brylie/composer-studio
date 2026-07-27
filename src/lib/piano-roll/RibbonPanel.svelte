<script module lang="ts">
  interface RibbonGroup {
    id: string;
    label: string;
    commandIds: string[];
  }

  interface RibbonTabDef {
    id: RibbonTabId;
    label: string;
    groups: RibbonGroup[];
  }

  // Adapted from ribbon.md's Tab → Group → Command model, restricted to the
  // commands actually implemented in the registry so far (transformations.md's
  // full catalog lands incrementally; groups pick up new commands by id).
  const RIBBON_TABS: RibbonTabDef[] = [
    {
      id: 'transform',
      label: 'Transform',
      groups: [
        { id: 'pitch', label: 'Pitch', commandIds: ['transpose', 'invert'] },
        { id: 'time', label: 'Time', commandIds: ['retrograde', 'augmentation', 'diminution'] },
        { id: 'structure', label: 'Structure', commandIds: ['permutation'] },
        { id: 'humanize', label: 'Humanize', commandIds: ['jitter'] },
      ],
    },
    {
      id: 'generate',
      label: 'Generate',
      groups: [{ id: 'harmony', label: 'Harmony', commandIds: ['generate-chords'] }],
    },
  ];

  // labelKey isn't wired to Paraglide messages yet (see commands/types.ts) — a
  // small local display map keeps the ribbon readable in the meantime.
  const COMMAND_LABELS: Record<string, string> = {
    transpose: 'Transpose',
    retrograde: 'Retrograde',
    invert: 'Invert',
    augmentation: 'Augmentation',
    diminution: 'Diminution',
    permutation: 'Permutation',
    jitter: 'Jitter',
    'generate-chords': 'Generate Chords',
  };

  const COMMAND_DESCRIPTIONS: Record<string, string> = {
    transpose: 'Shift pitch by semitones',
    retrograde: 'Reverse note order in time',
    invert: 'Mirror pitch around a center note',
    augmentation: 'Stretch note durations',
    diminution: 'Shrink note durations',
    permutation: 'Reorder selected notes',
    jitter: 'Randomize timing and pitch slightly',
    'generate-chords': 'Generate voice-led chords from the selection',
  };

  const DISABLED_REASON_TEXT: Record<string, string> = {
    'commands.disabled.selectAtLeastOne': 'Select at least one note',
    'commands.disabled.selectAtLeastTwo': 'Select at least two notes',
  };
</script>

<script lang="ts">
  import { MediaQuery } from 'svelte/reactivity';
  import { commandRegistry } from './commands/index.js';
  import type { CommandDescriptor } from './commands/types.js';
  import { getEditorState } from './context.svelte.js';
  import Icon from './Icon.svelte';
  import OverlayShell from './OverlayShell.svelte';
  import type { RibbonTabId } from './ribbon-ui.svelte.js';

  interface Props {
    sheet?: boolean;
  }

  const { sheet = false }: Props = $props();

  const { store, ribbonUi } = getEditorState();

  const isMobile = new MediaQuery('max-width: 599px');

  let activeCommandId = $state<string | null>(null);
  let params = $state<Record<string, unknown>>({});

  const commandsById = $derived(new Map(commandRegistry.map((c) => [c.id, c])));
  const activeCommand = $derived(
    activeCommandId ? (commandsById.get(activeCommandId) ?? null) : null,
  );

  function groupCommands(group: RibbonGroup): CommandDescriptor[] {
    return group.commandIds
      .map((id) => commandsById.get(id))
      .filter((c): c is CommandDescriptor => c !== undefined);
  }

  function updateParamValue(fieldKey: string, value: unknown) {
    params = { ...params, [fieldKey]: value };
  }

  function openCommand(command: CommandDescriptor) {
    activeCommandId = command.id;
    params = Object.fromEntries((command.params ?? []).map((field) => [field.key, field.default]));

    if (!command.params?.length) {
      void store.executeCommand(command.id);
      return;
    }

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

  // Fades whichever edge of a group's scrollable command row still has more
  // content, per ribbon.md's overflow treatment — no "+N more" affordance.
  function scrollFade(node: HTMLElement) {
    function update() {
      node.classList.toggle('fade-left', node.scrollLeft > 2);
      node.classList.toggle(
        'fade-right',
        node.scrollLeft + node.clientWidth < node.scrollWidth - 2,
      );
    }
    update();
    node.addEventListener('scroll', update, { passive: true });
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(node);
    return () => {
      node.removeEventListener('scroll', update);
      resizeObserver.disconnect();
    };
  }
</script>

<div class="ribbon" class:ribbon-sheet={sheet} role="toolbar" aria-label="Command ribbon">
  <div class="tabs" role="tablist" aria-label="Ribbon tabs">
    {#each RIBBON_TABS as tab (tab.id)}
      <button
        class="tab"
        role="tab"
        id="ribbon-tab-{tab.id}"
        aria-selected={ribbonUi.activeTab === tab.id}
        aria-controls="ribbon-panel-{tab.id}"
        class:active={ribbonUi.activeTab === tab.id}
        onclick={() => {
          ribbonUi.activeTab = tab.id;
        }}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  {#each RIBBON_TABS as tab (tab.id)}
    {#if ribbonUi.activeTab === tab.id}
      <div
        class="groups"
        role="tabpanel"
        id="ribbon-panel-{tab.id}"
        aria-labelledby="ribbon-tab-{tab.id}"
      >
        {#each tab.groups as group (group.id)}
          {@const commands = groupCommands(group)}
          {#if commands.length > 0}
            <div class="group">
              <span class="group-label">{group.label}</span>
              <div class="group-commands" {@attach scrollFade}>
                {#each commands as command (command.id)}
                  {@const isApplicable = command.isApplicable(store.commandContext)}
                  {@const reasonKey = !isApplicable
                    ? command.getDisabledReasonKey?.(store.commandContext)
                    : undefined}
                  <button
                    class="command-btn"
                    onclick={() => {
                      openCommand(command);
                    }}
                    disabled={!isApplicable}
                    aria-label={COMMAND_LABELS[command.id] ?? command.id}
                    title={!isApplicable && reasonKey
                      ? (DISABLED_REASON_TEXT[reasonKey] ?? undefined)
                      : (COMMAND_DESCRIPTIONS[command.id] ?? undefined)}
                  >
                    <Icon name={command.icon} />
                    <span class="command-label">{COMMAND_LABELS[command.id] ?? command.id}</span>
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  {/each}
</div>

<OverlayShell
  open={ribbonUi.paramsDrawerOpen && activeCommand !== null}
  title={activeCommand ? (COMMAND_LABELS[activeCommand.id] ?? activeCommand.id) : 'Command'}
  onclose={closeParamsDrawer}
>
  {#if activeCommand}
    <div class="params-form">
      {#each activeCommand.params ?? [] as field (field.key)}
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
      {/each}

      <button class="run-btn" onclick={runActiveCommand}>Apply</button>
    </div>
  {/if}
</OverlayShell>

<style>
  .ribbon {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 12px;
    background: #161628;
    border-bottom: 1px solid #292944;
  }

  .ribbon-sheet {
    border-bottom: none;
    background: transparent;
    padding: 10px 14px 16px;
  }

  .tabs {
    display: flex;
    gap: 6px;
  }

  .tab {
    border: 1px solid #2a2a45;
    background: #1c1c30;
    color: #9090c0;
    border-radius: 999px;
    padding: 4px 12px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition:
      background 0.12s,
      color 0.12s;
  }

  .tab:hover {
    color: #c0c0e8;
  }

  .tab:focus-visible {
    outline: 2px solid #6b6bd9;
    outline-offset: 2px;
  }

  .tab.active {
    background: #6b6bd9;
    border-color: #8888ee;
    color: #fff;
  }

  .groups {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 4px;
    /* Flex items default to min-width:auto, which would let a group's own
       command row (below) grow past its container instead of scrolling
       internally — see ribbon.md's overflow treatment. */
    min-width: 0;
    max-width: 100%;
  }

  .group-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #666888;
    padding-left: 2px;
  }

  .group-commands {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    scroll-snap-type: x proximity;
    padding: 1px;
  }

  /* fade-left/-right are toggled imperatively by the scrollFade attachment,
     not from the template, hence :global() so Svelte doesn't prune them. */
  .group-commands:global(.fade-left) {
    -webkit-mask-image: linear-gradient(to right, transparent, black 16px);
    mask-image: linear-gradient(to right, transparent, black 16px);
  }

  .group-commands:global(.fade-right) {
    -webkit-mask-image: linear-gradient(to left, transparent, black 16px);
    mask-image: linear-gradient(to left, transparent, black 16px);
  }

  .group-commands:global(.fade-left.fade-right) {
    -webkit-mask-image: linear-gradient(
      to right,
      transparent,
      black 16px,
      black calc(100% - 16px),
      transparent
    );
    mask-image: linear-gradient(
      to right,
      transparent,
      black 16px,
      black calc(100% - 16px),
      transparent
    );
  }

  .group-commands::-webkit-scrollbar {
    display: none;
  }

  .command-btn {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    border: 1px solid #2a2a45;
    background: #1e1e34;
    color: #d0d0f0;
    border-radius: 8px;
    padding: 6px 10px;
    min-width: 62px;
    cursor: pointer;
    scroll-snap-align: start;
    transition:
      background 0.12s,
      border-color 0.12s;
  }

  .command-btn:hover:not(:disabled) {
    background: #262646;
    border-color: #3a3a60;
  }

  .command-btn:focus-visible {
    outline: 2px solid #6b6bd9;
    outline-offset: 1px;
  }

  .command-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .command-label {
    font-size: 10px;
    font-weight: 500;
    white-space: nowrap;
  }

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
