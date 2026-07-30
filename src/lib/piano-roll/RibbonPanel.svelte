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
</script>

<script lang="ts">
  import {
    COMMAND_DESCRIPTIONS,
    COMMAND_LABELS,
    DISABLED_REASON_TEXT,
    GENERATOR_DESCRIPTIONS,
    GENERATOR_LABELS,
  } from './command-metadata.js';
  import { commandRegistry } from './commands/index.js';
  import type { CommandDescriptor } from './commands/types.js';
  import { getEditorState } from './context.svelte.js';
  import { generatorCatalog } from './generators/catalog.js';
  import type { GeneratorDescriptor } from './generators/types.js';
  import Icon from './Icon.svelte';
  import type { RibbonTabId } from './ribbon-ui.svelte.js';

  interface Props {
    sheet?: boolean;
    onOpenCommand: (command: CommandDescriptor) => void;
    onStartGenerator: (descriptor: GeneratorDescriptor) => void;
    onBrowseGenerators: () => void;
  }

  const { sheet = false, onOpenCommand, onStartGenerator, onBrowseGenerators }: Props = $props();

  const { store, ribbonUi } = getEditorState();

  const commandsById = $derived(new Map(commandRegistry.map((c) => [c.id, c])));

  // The contextual 'generator-session' tab (generators.md §7.5) only exists
  // while a session is active — appended dynamically rather than living in
  // the static RIBBON_TABS list above.
  const visibleTabs = $derived([
    ...RIBBON_TABS,
    ...(store.generatorSession
      ? [{ id: 'generator-session' as const, label: 'Generator', groups: [] }]
      : []),
  ]);

  /** After Apply/Cancel closes the session, the contextual tab disappears from visibleTabs — switch off it so the ribbon isn't left pointed at a tab with no matching panel. */
  function closeGeneratorSessionTab() {
    if (ribbonUi.activeTab === 'generator-session') ribbonUi.activeTab = 'generate';
  }

  function groupCommands(group: RibbonGroup): CommandDescriptor[] {
    return group.commandIds
      .map((id) => commandsById.get(id))
      .filter((c): c is CommandDescriptor => c !== undefined);
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
    {#each visibleTabs as tab (tab.id)}
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

  {#each visibleTabs as tab (tab.id)}
    {#if ribbonUi.activeTab === tab.id}
      <div
        class="groups"
        role="tabpanel"
        id="ribbon-panel-{tab.id}"
        aria-labelledby="ribbon-tab-{tab.id}"
      >
        {#if tab.id === 'generator-session' && store.generatorSession}
          {@const session = store.generatorSession}
          {@const canApply = store.canApplyGeneratorSession}
          <div class="group">
            <span class="group-label">Session</span>
            <div class="group-commands">
              <button
                class="command-btn"
                onclick={() => {
                  store.recomputeGeneratorSession();
                }}
              >
                <Icon name="refresh" />
                <span class="command-label">Recompute</span>
              </button>
              <button
                class="command-btn"
                onclick={() => {
                  store.rerollGeneratorSession();
                }}
              >
                <Icon name="dice" />
                <span class="command-label">Reroll</span>
              </button>
              <button
                class="command-btn"
                disabled={session.history.index <= 0}
                onclick={() => {
                  store.stepGeneratorVariation('previous');
                }}
              >
                <Icon name="step-back" />
                <span class="command-label">Previous</span>
              </button>
              <button
                class="command-btn"
                disabled={session.history.index >= session.history.checkpoints.length - 1}
                onclick={() => {
                  store.stepGeneratorVariation('next');
                }}
              >
                <Icon name="step-forward" />
                <span class="command-label">Next</span>
              </button>
              <button
                class="command-btn"
                disabled={!canApply}
                title={canApply ? undefined : 'Recompute to a non-error result before applying'}
                onclick={() => {
                  store.applyGeneratorSession();
                  closeGeneratorSessionTab();
                }}
              >
                <Icon name="plus" />
                <span class="command-label">Apply</span>
              </button>
              <button
                class="command-btn"
                onclick={() => {
                  store.cancelGeneratorSession();
                  closeGeneratorSessionTab();
                }}
              >
                <Icon name="close" />
                <span class="command-label">Cancel</span>
              </button>
            </div>
          </div>
        {:else}
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
                        onOpenCommand(command);
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

          {#if tab.id === 'generate'}
            {@const sessionActive = !!store.generatorSession}
            <div class="group">
              <span class="group-label">Generators</span>
              <div class="group-commands" {@attach scrollFade}>
                {#each generatorCatalog as descriptor (descriptor.id)}
                  <button
                    class="command-btn"
                    onclick={() => {
                      onStartGenerator(descriptor);
                    }}
                    disabled={sessionActive}
                    aria-label={GENERATOR_LABELS[descriptor.id] ?? descriptor.id}
                    title={sessionActive
                      ? 'Apply or cancel the active generator session first'
                      : GENERATOR_DESCRIPTIONS[descriptor.id]}
                  >
                    <Icon name={descriptor.icon} />
                    <span class="command-label"
                      >{GENERATOR_LABELS[descriptor.id] ?? descriptor.id}</span
                    >
                  </button>
                {/each}
                <button
                  class="command-btn"
                  onclick={onBrowseGenerators}
                  disabled={sessionActive}
                  aria-label="Browse generators"
                  title={sessionActive
                    ? 'Apply or cancel the active generator session first'
                    : undefined}
                >
                  <Icon name="layers" />
                  <span class="command-label">Browse…</span>
                </button>
              </div>
            </div>
          {/if}
        {/if}
      </div>
    {/if}
  {/each}
</div>

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
</style>
