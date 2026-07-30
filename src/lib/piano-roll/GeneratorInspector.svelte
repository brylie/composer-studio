<script lang="ts">
  // The generator session's single non-modal side inspector (generators.md
  // §1.1, §7.1): name + Apply/Cancel, bounds/commit-mode summary, the
  // ordered module chain, one selected module's detail editor, and
  // diagnostics/variation controls at the bottom. Always visible alongside
  // the grid while a session is active — never an OverlayShell drawer, since
  // generators.md §7.8 requires routine editing to need no modal.
  import { getEditorState } from './context.svelte.js';
  import Icon from './Icon.svelte';
  import {
    duplicateNode,
    insertNode,
    moveNode,
    removeNode,
    resetNodeParams,
    toggleNodeEnabled,
    updateNodeParams,
  } from './generators/chain-edit.js';
  import { insertableModules, operatorRegistry } from './generators/index.js';
  import type { ChainEditResult } from './generators/chain-edit.js';
  import type { GeneratorCommitMode } from './generators/session.js';
  import type { GeneratorBounds, VariationLocks } from './generators/types.js';
  import { MAX_MIDI, MIN_MIDI } from './types.js';

  const { store, ribbonUi } = getEditorState();

  const session = $derived(store.generatorSession);

  let selectedNodeId: string | null = $state(null);
  let chainError: string | null = $state(null);
  let addModuleOperatorId = $state(insertableModules[0]?.operatorId ?? '');

  // Keep the selection valid across recipe edits (a removed node, or a
  // brand-new session) — falls back to the first module rather than leaving
  // the detail editor pointed at a node that no longer exists.
  $effect(() => {
    const nodes = session?.recipe.nodes ?? [];
    if (!nodes.some((n) => n.id === selectedNodeId)) {
      selectedNodeId = nodes[0]?.id ?? null;
    }
  });

  /**
   * A module card's overflow `<details class="more-menu">` only closes
   * natively on its own summary click (or an item's own handler) — a native
   * `<details>` doesn't dismiss on an outside click or Escape the way a real
   * menu/popover does, which is surprising for a dropdown-shaped control.
   * One delegated pair of document listeners covers every module card's
   * menu rather than per-node listeners.
   */
  $effect(() => {
    function closeOpenMenus(exceptTarget?: Node) {
      document.querySelectorAll<HTMLDetailsElement>('.more-menu[open]').forEach((details) => {
        if (exceptTarget && details.contains(exceptTarget)) return;
        const hadFocusInside = details.contains(document.activeElement);
        details.removeAttribute('open');
        if (hadFocusInside) details.querySelector('summary')?.focus();
      });
    }
    function onPointerDown(e: PointerEvent) {
      closeOpenMenus(e.target as Node);
    }
    function onKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeOpenMenus();
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeydown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeydown);
    };
  });

  const selectedNode = $derived(session?.recipe.nodes.find((n) => n.id === selectedNodeId) ?? null);
  const selectedOperator = $derived(
    selectedNode ? operatorRegistry.get(selectedNode.operatorId) : undefined,
  );

  /** Apply must not be offered for a session with nothing valid to commit — applyGeneratorSession() itself just closes the session in that case, silently discarding the visible preview otherwise (generators.md §6.1 step 5). */
  const canApply = $derived(store.canApplyGeneratorSession);

  const LOCK_DIMENSIONS: { key: keyof VariationLocks; label: string }[] = [
    { key: 'rhythm', label: 'Rhythm' },
    { key: 'pitch', label: 'Pitch' },
    { key: 'contour', label: 'Contour' },
    { key: 'register', label: 'Register' },
    { key: 'voicing', label: 'Voicing' },
    { key: 'dynamics', label: 'Dynamics' },
  ];

  /** Which lock chips are shown — only dimensions an operator actually in the chain can randomize, rather than always all six (most are inert for the current recipe). */
  const visibleLockDimensions = $derived.by(() => {
    if (!session) return [];
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain local lookup, discarded immediately, never read reactively
    const present = new Set<keyof VariationLocks>();
    for (const node of session.recipe.nodes) {
      const operator = operatorRegistry.get(node.operatorId);
      for (const dim of operator?.variationDimensions ?? []) present.add(dim);
    }
    return LOCK_DIMENSIONS.filter((d) => present.has(d.key));
  });

  const COMMIT_MODES: { value: GeneratorCommitMode; label: string }[] = [
    { value: 'insert', label: 'Insert' },
    { value: 'replace-selection', label: 'Replace selection' },
    { value: 'replace-bounds', label: 'Replace bounds' },
  ];

  function applyChainEdit(result: ChainEditResult) {
    chainError = result.error;
    if (!result.error) store.updateGeneratorRecipe(result.recipe);
  }

  function moveModule(nodeId: string, direction: 'up' | 'down') {
    if (!session) return;
    applyChainEdit(moveNode(session.recipe, nodeId, direction, operatorRegistry));
  }

  function toggleModule(nodeId: string) {
    if (!session) return;
    chainError = null;
    store.updateGeneratorRecipe(toggleNodeEnabled(session.recipe, nodeId));
  }

  function removeModule(nodeId: string) {
    if (!session) return;
    applyChainEdit(removeNode(session.recipe, nodeId, operatorRegistry));
  }

  function duplicateModule(nodeId: string) {
    if (!session) return;
    applyChainEdit(duplicateNode(session.recipe, nodeId, operatorRegistry));
  }

  function resetModule(nodeId: string) {
    const ctx = store.generatorContext;
    if (!session || !ctx) return;
    chainError = null;
    store.updateGeneratorRecipe(resetNodeParams(session.recipe, nodeId, ctx, operatorRegistry));
  }

  function addModule() {
    const ctx = store.generatorContext;
    if (!session || !ctx || !addModuleOperatorId) return;
    applyChainEdit(
      insertNode(
        session.recipe,
        addModuleOperatorId,
        ctx,
        operatorRegistry,
        selectedNodeId ?? undefined,
      ),
    );
  }

  function updateParam(nodeId: string, key: string, value: unknown) {
    if (!session) return;
    chainError = null;
    store.updateGeneratorRecipe(updateNodeParams(session.recipe, nodeId, { [key]: value }));
  }

  /** After Apply/Cancel closes the session, the contextual ribbon tab disappears from its visible-tabs list — switch off it so the ribbon isn't left pointed at a tab with no matching panel. */
  function closeSessionTabIfActive() {
    if (ribbonUi.activeTab === 'generator-session') ribbonUi.activeTab = 'generate';
  }

  function updateBounds(patch: Partial<GeneratorBounds['time'] & GeneratorBounds['pitch']>) {
    if (!session) return;
    const bounds = session.bounds;
    const next: GeneratorBounds = {
      time: {
        startBeat: patch.startBeat ?? bounds.time.startBeat,
        endBeat: patch.endBeat ?? bounds.time.endBeat,
      },
      pitch: {
        minMidi: patch.minMidi ?? bounds.pitch.minMidi,
        maxMidi: patch.maxMidi ?? bounds.pitch.maxMidi,
      },
      allowTail: bounds.allowTail,
    };
    store.updateGeneratorBounds(next);
  }

  function setAllowTail(allowTail: boolean) {
    if (!session) return;
    store.updateGeneratorBounds({ ...session.bounds, allowTail });
  }
</script>

{#if session}
  <div class="inspector" role="complementary" aria-label="Generator inspector">
    <div class="section header-section">
      <div class="title-row">
        <span class="session-name">{session.name}</span>
        <span class="status status-{session.status}">{session.status}</span>
      </div>
      <div class="primary-actions">
        <button
          type="button"
          class="apply-btn"
          disabled={!canApply}
          title={canApply ? undefined : 'Recompute to a non-error result before applying'}
          onclick={() => {
            store.applyGeneratorSession();
            closeSessionTabIfActive();
          }}
        >
          Apply
        </button>
        <button
          type="button"
          class="cancel-btn"
          onclick={() => {
            store.cancelGeneratorSession();
            closeSessionTabIfActive();
          }}
        >
          Cancel
        </button>
      </div>
      {#if session.status === 'stale'}
        <div class="stale-banner">
          Context changed since this was last evaluated.
          <button
            type="button"
            class="recompute-btn"
            onclick={() => {
              store.recomputeGeneratorSession();
            }}
          >
            <Icon name="refresh" /> Recompute
          </button>
        </div>
      {/if}
    </div>

    <div class="section">
      <div class="section-label">Variation</div>
      <div class="variation-row">
        <button
          type="button"
          class="icon-action"
          aria-label="Previous variation"
          disabled={session.history.index <= 0}
          onclick={() => {
            store.stepGeneratorVariation('previous');
          }}
        >
          <Icon name="step-back" />
        </button>
        <button
          type="button"
          class="reroll-action"
          onclick={() => {
            store.rerollGeneratorSession();
          }}
        >
          <Icon name="dice" /> Reroll
        </button>
        <button
          type="button"
          class="icon-action"
          aria-label="Next variation"
          disabled={session.history.index >= session.history.checkpoints.length - 1}
          onclick={() => {
            store.stepGeneratorVariation('next');
          }}
        >
          <Icon name="step-forward" />
        </button>
      </div>
      <div class="locks-grid" role="group" aria-label="Locked dimensions">
        {#each visibleLockDimensions as dim (dim.key)}
          <button
            type="button"
            class="lock-chip"
            class:active={session.variation.locks[dim.key]}
            aria-pressed={session.variation.locks[dim.key]}
            onclick={() => {
              store.setGeneratorLocks({ [dim.key]: !session.variation.locks[dim.key] });
            }}
          >
            <Icon name={session.variation.locks[dim.key] ? 'lock' : 'unlock'} />
            {dim.label}
          </button>
        {/each}
      </div>
    </div>

    <div class="section">
      <div class="section-label">Bounds</div>
      <div class="bounds-grid">
        <label class="field">
          <span>Start beat</span>
          <input
            type="number"
            value={session.bounds.time.startBeat}
            min="0"
            step={store.snapBeats}
            onchange={(e) => {
              updateBounds({ startBeat: Number(e.currentTarget.value) });
            }}
          />
        </label>
        <label class="field">
          <span>End beat</span>
          <input
            type="number"
            value={session.bounds.time.endBeat}
            min="0"
            step={store.snapBeats}
            onchange={(e) => {
              updateBounds({ endBeat: Number(e.currentTarget.value) });
            }}
          />
        </label>
        <label class="field">
          <span>Min pitch</span>
          <input
            type="number"
            value={session.bounds.pitch.minMidi}
            min={MIN_MIDI}
            max={MAX_MIDI}
            onchange={(e) => {
              updateBounds({ minMidi: Number(e.currentTarget.value) });
            }}
          />
        </label>
        <label class="field">
          <span>Max pitch</span>
          <input
            type="number"
            value={session.bounds.pitch.maxMidi}
            min={MIN_MIDI}
            max={MAX_MIDI}
            onchange={(e) => {
              updateBounds({ maxMidi: Number(e.currentTarget.value) });
            }}
          />
        </label>
      </div>
      <label class="checkbox-field">
        <input
          type="checkbox"
          checked={session.bounds.allowTail}
          onchange={(e) => {
            setAllowTail(e.currentTarget.checked);
          }}
        />
        Allow notes to sustain past the end beat
      </label>

      <label class="field commit-mode-field">
        <span>On Apply</span>
        <select
          value={session.commitMode}
          onchange={(e) => {
            store.setGeneratorCommitMode(e.currentTarget.value as GeneratorCommitMode);
          }}
        >
          {#each COMMIT_MODES as mode (mode.value)}
            <option
              value={mode.value}
              disabled={mode.value === 'replace-selection' &&
                session.source.kind !== 'captured-notes'}
            >
              {mode.label}
            </option>
          {/each}
        </select>
      </label>
    </div>

    <div class="section">
      <div class="section-label">Modules</div>
      {#if chainError}
        <div class="chain-error" role="alert">{chainError}</div>
      {/if}
      <div class="module-list">
        {#each session.recipe.nodes as node, index (node.id)}
          {@const operator = operatorRegistry.get(node.operatorId)}
          {@const summaryText = operator?.summary?.(node.params)}
          <div
            class="module-card"
            class:selected={selectedNodeId === node.id}
            class:bypassed={!node.enabled}
          >
            <button
              type="button"
              class="module-select"
              aria-pressed={selectedNodeId === node.id}
              onclick={() => {
                selectedNodeId = node.id;
              }}
            >
              <span class="module-name">{operator?.label ?? node.operatorId}</span>
              {#if summaryText}
                <span class="module-summary">{summaryText}</span>
              {/if}
            </button>
            <span class="module-actions">
              <button
                type="button"
                class="module-icon-btn"
                aria-label="Move {operator?.label ?? node.operatorId} up"
                disabled={index === 0}
                onclick={(e) => {
                  e.stopPropagation();
                  moveModule(node.id, 'up');
                }}
              >
                <Icon name="step-back" />
              </button>
              <button
                type="button"
                class="module-icon-btn"
                aria-label="Move {operator?.label ?? node.operatorId} down"
                disabled={index === session.recipe.nodes.length - 1}
                onclick={(e) => {
                  e.stopPropagation();
                  moveModule(node.id, 'down');
                }}
              >
                <Icon name="step-forward" />
              </button>
              <button
                type="button"
                class="module-icon-btn"
                aria-pressed={!node.enabled}
                aria-label={node.enabled
                  ? `Bypass ${operator?.label ?? node.operatorId}`
                  : `Re-enable ${operator?.label ?? node.operatorId}`}
                onclick={(e) => {
                  e.stopPropagation();
                  toggleModule(node.id);
                }}
              >
                <Icon name={node.enabled ? 'eye' : 'lock'} />
              </button>
              <!-- Duplicate/reset/remove are edited far less often than move/bypass
                   (generators.md §7.2), so they live behind one overflow
                   disclosure instead of three permanently-visible buttons. -->
              <details class="more-menu">
                <summary
                  class="module-icon-btn"
                  aria-label="More actions for {operator?.label ?? node.operatorId}"
                  onclick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  <Icon name="more" />
                </summary>
                <div class="more-menu-items" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onclick={(e) => {
                      e.stopPropagation();
                      duplicateModule(node.id);
                      e.currentTarget.closest('details')?.removeAttribute('open');
                    }}
                  >
                    <Icon name="plus" /> Duplicate
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onclick={(e) => {
                      e.stopPropagation();
                      resetModule(node.id);
                      e.currentTarget.closest('details')?.removeAttribute('open');
                    }}
                  >
                    <Icon name="refresh" /> Reset
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    class="danger"
                    onclick={(e) => {
                      e.stopPropagation();
                      removeModule(node.id);
                      e.currentTarget.closest('details')?.removeAttribute('open');
                    }}
                  >
                    <Icon name="trash" /> Remove
                  </button>
                </div>
              </details>
            </span>
          </div>
        {/each}
      </div>

      {#if insertableModules.length > 0}
        <div class="add-module-row">
          <select bind:value={addModuleOperatorId} aria-label="Module to add">
            {#each insertableModules as mod (mod.operatorId)}
              <option value={mod.operatorId}>{mod.label}</option>
            {/each}
          </select>
          <button type="button" class="add-module-btn" onclick={addModule}>
            <Icon name="plus" /> Add module
          </button>
        </div>
      {/if}
    </div>

    {#if selectedNode && selectedOperator}
      <div class="section">
        <div class="section-label">{selectedOperator.label}</div>
        <div class="param-fields">
          {#each selectedOperator.paramFields ?? [] as field (field.key)}
            {@const params = selectedNode.params}
            <label class="field">
              <span>{field.label}</span>
              {#if field.type === 'number'}
                <input
                  type="number"
                  value={typeof params[field.key] === 'number' ? params[field.key] : field.default}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  onchange={(e) => {
                    updateParam(selectedNode.id, field.key, Number(e.currentTarget.value));
                  }}
                />
              {:else if field.type === 'range'}
                {@const rangeCurrent =
                  typeof params[field.key] === 'number' ? params[field.key] : field.default}
                <div class="range-row">
                  <input
                    class="slider"
                    type="range"
                    value={rangeCurrent}
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    oninput={(e) => {
                      updateParam(selectedNode.id, field.key, Number(e.currentTarget.value));
                    }}
                  />
                  <span class="range-value">{rangeCurrent}</span>
                </div>
              {:else if field.type === 'select'}
                <select
                  value={typeof params[field.key] === 'string' ? params[field.key] : field.default}
                  onchange={(e) => {
                    updateParam(selectedNode.id, field.key, e.currentTarget.value);
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
                  onchange={(e) => {
                    updateParam(selectedNode.id, field.key, e.currentTarget.checked);
                  }}
                />
              {:else if field.type === 'number-range'}
                {@const rangeValue =
                  typeof params[field.key] === 'object' && params[field.key] !== null
                    ? (params[field.key] as { min: number; max: number })
                    : field.default}
                <div class="range-pair">
                  <input
                    type="number"
                    value={rangeValue.min}
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    onchange={(e) => {
                      updateParam(selectedNode.id, field.key, {
                        ...rangeValue,
                        min: Number(e.currentTarget.value),
                      });
                    }}
                  />
                  <span class="range-pair-sep">to</span>
                  <input
                    type="number"
                    value={rangeValue.max}
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    onchange={(e) => {
                      updateParam(selectedNode.id, field.key, {
                        ...rangeValue,
                        max: Number(e.currentTarget.value),
                      });
                    }}
                  />
                </div>
              {/if}
            </label>
          {:else}
            <p class="no-params">This module has no parameters.</p>
          {/each}
        </div>
      </div>
    {/if}

    {#if store.generatorDiagnostics.length > 0}
      <div class="section">
        <div class="section-label">Diagnostics</div>
        <ul class="diagnostics-list">
          {#each store.generatorDiagnostics as diagnostic, i (i)}
            <li class="diagnostic diagnostic-{diagnostic.level}">{diagnostic.message}</li>
          {/each}
        </ul>
      </div>
    {/if}
  </div>
{/if}

<style>
  .inspector {
    width: 300px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
    overflow-y: auto;
    background: #14141f;
    color: #e0e0f0;
    border-left: 1px solid #2a2a45;
  }

  .section {
    padding: 12px 14px;
    border-bottom: 1px solid #222238;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .section-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #666888;
  }

  .title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .session-name {
    font-size: 14px;
    font-weight: 700;
    color: #f0f0ff;
  }

  .status {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 2px 6px;
    border-radius: 4px;
    background: #232338;
    color: #9090c0;
  }

  .status-stale {
    background: #3a3016;
    color: #f5b942;
  }

  .status-error {
    background: #3a1616;
    color: #ef8080;
  }

  .primary-actions {
    display: flex;
    gap: 8px;
  }

  .apply-btn,
  .cancel-btn,
  .recompute-btn,
  .add-module-btn {
    padding: 7px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    border: none;
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .apply-btn {
    flex: 1;
    background: #6b6bd9;
    color: #fff;
  }

  .apply-btn:hover:not(:disabled) {
    background: #7c7ce8;
  }

  .apply-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .cancel-btn {
    background: transparent;
    border: 1px solid #3a3a60;
    color: #c0c0e0;
  }

  .cancel-btn:hover {
    background: #1e1e34;
  }

  .stale-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 8px;
    background: #241d0a;
    border: 1px solid #4a3a10;
    border-radius: 6px;
    font-size: 11px;
    color: #f5b942;
  }

  .recompute-btn {
    background: #f5b942;
    color: #1a1305;
    padding: 4px 8px;
  }

  .variation-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .reroll-action {
    flex: 1;
    padding: 7px 10px;
    border: 1px solid #3a3a60;
    border-radius: 6px;
    background: #1c1c30;
    color: #d0d0f0;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  .reroll-action:hover {
    background: #262646;
  }

  .icon-action {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid #2a2a45;
    border-radius: 6px;
    background: #1c1c30;
    color: #9090c0;
    cursor: pointer;
  }

  .icon-action:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .locks-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .lock-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border-radius: 999px;
    border: 1px solid #2a2a45;
    background: #1c1c30;
    color: #8888aa;
    font-size: 11px;
    cursor: pointer;
  }

  .lock-chip.active {
    background: #2a2450;
    border-color: #6b6bd9;
    color: #d0d0ff;
  }

  .bounds-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11px;
    color: #9090c0;
  }

  .field input,
  .field select {
    width: 100%;
    border: 1px solid #2a2a45;
    background: #0d0d1c;
    color: #f0f0ff;
    border-radius: 6px;
    padding: 5px 7px;
    font-size: 12px;
    box-sizing: border-box;
  }

  .checkbox-field {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: #9090c0;
  }

  .commit-mode-field {
    margin-top: 2px;
  }

  .module-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .module-card {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    padding: 8px;
    border: 1px solid #2a2a45;
    border-radius: 8px;
    background: #1a1a2c;
    color: #d0d0f0;
    width: 100%;
    box-sizing: border-box;
  }

  .module-card.selected {
    border-color: #6b6bd9;
    background: #201f3c;
  }

  .module-card.bypassed {
    opacity: 0.55;
  }

  .module-select {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
    padding: 0;
  }

  .module-name {
    font-size: 12px;
    font-weight: 700;
  }

  .module-summary {
    font-size: 11px;
    color: #8888aa;
  }

  .module-actions {
    display: flex;
    gap: 3px;
    margin-left: auto;
  }

  .module-icon-btn {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: #9090c0;
    cursor: pointer;
  }

  .module-icon-btn:hover:not(:disabled) {
    background: #2a2a4a;
  }

  .module-icon-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .module-icon-btn.danger {
    color: #d08080;
  }

  .more-menu {
    position: relative;
  }

  .more-menu > summary {
    list-style: none;
  }

  .more-menu > summary::-webkit-details-marker {
    display: none;
  }

  .more-menu-items {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 120px;
    padding: 4px;
    border: 1px solid #2a2a45;
    border-radius: 8px;
    background: #1c1c30;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  }

  .more-menu-items button {
    display: flex;
    align-items: center;
    gap: 6px;
    border: none;
    background: transparent;
    color: #d0d0f0;
    font-size: 12px;
    padding: 6px 8px;
    border-radius: 5px;
    cursor: pointer;
    text-align: left;
  }

  .more-menu-items button:hover {
    background: #2a2a4a;
  }

  .more-menu-items button.danger {
    color: #d08080;
  }

  .chain-error {
    font-size: 11px;
    color: #ef8080;
    background: #2a1414;
    border: 1px solid #4a2a2a;
    border-radius: 6px;
    padding: 6px 8px;
  }

  .add-module-row {
    display: flex;
    gap: 6px;
  }

  .add-module-row select {
    flex: 1;
    border: 1px solid #2a2a45;
    background: #0d0d1c;
    color: #f0f0ff;
    border-radius: 6px;
    padding: 5px 7px;
    font-size: 12px;
  }

  .add-module-btn {
    background: transparent;
    border: 1px dashed #3a3a60;
    color: #9090c0;
  }

  .param-fields {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .no-params {
    font-size: 11px;
    color: #666888;
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
    font-size: 11px;
    color: #c0c0e0;
    min-width: 28px;
    text-align: right;
  }

  .range-pair {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .range-pair-sep {
    font-size: 10px;
    color: #666888;
  }

  .diagnostics-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .diagnostic {
    font-size: 11px;
    padding: 5px 7px;
    border-radius: 5px;
    background: #1c1c30;
    color: #9090c0;
  }

  .diagnostic-warning {
    background: #2a2410;
    color: #e0c060;
  }

  .diagnostic-error {
    background: #2a1414;
    color: #ef8080;
  }
</style>
