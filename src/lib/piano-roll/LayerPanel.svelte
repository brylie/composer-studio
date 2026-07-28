<script lang="ts">
  import { getEditorState } from './context.svelte.js';
  import Icon from './Icon.svelte';

  const { store } = getEditorState();

  // ── Reorder-by-drag (layers.md: "drag to reorder — reordering *is*
  // re-stacking"). Pointer-based, matching the codebase's existing
  // pointer-capture drag conventions (NoteGrid.svelte, arranger lanes)
  // rather than HTML5 drag-and-drop. Purely a UI-level "where would this
  // land" tracker while dragging; the store is only touched once, on
  // pointer-up, so a drag produces exactly one history entry rather than
  // one per pixel of movement.
  let dragId: string | null = $state(null);
  let dragOverIndex: number | null = $state(null);
  let listEl: HTMLDivElement | undefined = $state();

  function commitRename(id: string, value: string) {
    const trimmed = value.trim();
    if (trimmed) store.renameLayer(id, trimmed);
  }

  function handleDragPointerDown(e: PointerEvent, id: string) {
    if (e.button !== 0) return;
    dragId = id;
    dragOverIndex = store.layers.findIndex((l) => l.id === id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handleDragPointerMove(e: PointerEvent) {
    if (!dragId || !listEl) return;
    const rows = Array.from(listEl.querySelectorAll<HTMLElement>('.layer-row'));
    let index = rows.length - 1;
    for (let i = 0; i < rows.length; i++) {
      const rect = rows[i].getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) {
        index = i;
        break;
      }
    }
    dragOverIndex = index;
  }

  function handleDragPointerUp(e: PointerEvent) {
    if (dragId && dragOverIndex !== null) {
      store.moveLayer(dragId, dragOverIndex);
    }
    dragId = null;
    dragOverIndex = null;
    const target = e.currentTarget as HTMLElement;
    if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
  }

  /** Keyboard equivalent of the pointer drag above — Arrow Up/Down moves the row one step, matching the same `store.moveLayer` call the drag commits on pointer-up. */
  function handleDragKeydown(e: KeyboardEvent, id: string, index: number) {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      store.moveLayer(id, index - 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      store.moveLayer(id, index + 1);
    }
  }
</script>

<div class="layer-panel">
  <div class="layer-list" bind:this={listEl}>
    {#each store.layers as layer, index (layer.id)}
      <div
        class="layer-row"
        class:dragging={dragId === layer.id}
        class:drop-before={dragOverIndex === index && dragId !== null && dragId !== layer.id}
      >
        <button
          type="button"
          class="drag-handle"
          aria-label="Reorder {layer.name}"
          onpointerdown={(e) => {
            handleDragPointerDown(e, layer.id);
          }}
          onpointermove={handleDragPointerMove}
          onpointerup={handleDragPointerUp}
          onkeydown={(e) => {
            handleDragKeydown(e, layer.id, index);
          }}
        >
          <Icon name="grip" />
        </button>

        <button
          type="button"
          class="active-dot"
          class:active={layer.id === store.activeLayerId}
          style="--layer-color: {layer.color};"
          role="radio"
          aria-checked={layer.id === store.activeLayerId}
          aria-label="Set {layer.name} as the active layer"
          onclick={() => {
            store.activeLayerId = layer.id;
          }}
        ></button>

        <input
          class="name-input"
          type="text"
          value={layer.name}
          aria-label="Layer name"
          onblur={(e) => {
            commitRename(layer.id, (e.target as HTMLInputElement).value);
          }}
          onkeydown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />

        <button
          type="button"
          class="icon-toggle"
          class:inactive={!layer.visible}
          aria-pressed={layer.visible}
          aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
          title={layer.visible ? 'Hide layer' : 'Show layer'}
          onclick={() => {
            store.setLayerVisible(layer.id, !layer.visible);
          }}
        >
          <Icon name="eye" />
        </button>

        <button
          type="button"
          class="icon-toggle"
          class:inactive={layer.locked}
          aria-pressed={layer.locked}
          aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
          title={layer.locked ? 'Unlock layer' : 'Lock layer'}
          onclick={() => {
            store.setLayerLocked(layer.id, !layer.locked);
          }}
        >
          <Icon name={layer.locked ? 'lock' : 'unlock'} />
        </button>

        <button
          type="button"
          class="icon-toggle delete-btn"
          disabled={store.layers.length <= 1}
          aria-label="Delete {layer.name}"
          title={store.layers.length <= 1 ? "Can't delete the only layer" : 'Delete layer'}
          onclick={() => {
            store.removeLayer(layer.id);
          }}
        >
          <Icon name="trash" />
        </button>
      </div>
    {/each}
  </div>

  <button
    type="button"
    class="add-layer-btn"
    onclick={() => {
      store.addLayer();
    }}
  >
    <Icon name="plus" />
    Add layer
  </button>
</div>

<style>
  .layer-panel {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .layer-list {
    display: flex;
    flex-direction: column;
  }

  .layer-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid #222238;
  }

  .layer-row.dragging {
    opacity: 0.5;
  }

  .layer-row.drop-before {
    box-shadow: inset 0 2px 0 0 #6b6bd9;
  }

  .drag-handle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: #666888;
    cursor: grab;
    touch-action: none;
  }

  .drag-handle:hover {
    color: #9090c0;
  }

  .active-dot {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    border-radius: 50%;
    border: 2px solid var(--layer-color, #6b6bd9);
    background: transparent;
    cursor: pointer;
    padding: 0;
  }

  .active-dot.active {
    background: var(--layer-color, #6b6bd9);
  }

  .name-input {
    flex: 1;
    min-width: 0;
    padding: 4px 6px;
    background: #0d0d1c;
    border: 1px solid #2a2a45;
    border-radius: 5px;
    color: #c0c0e0;
    font-size: 12px;
    box-sizing: border-box;
  }

  .name-input:focus {
    outline: 1px solid #6b6bd9;
  }

  .icon-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: #b0b0e0;
    cursor: pointer;
    transition: background 0.12s;
  }

  .icon-toggle:hover:not(:disabled) {
    background: #252545;
  }

  .icon-toggle.inactive {
    color: #555577;
  }

  .icon-toggle:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .delete-btn {
    color: #d08080;
  }

  .add-layer-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    margin: 10px;
    padding: 8px 12px;
    border: 1px dashed #3a3a60;
    border-radius: 6px;
    background: transparent;
    color: #9090c0;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.12s;
  }

  .add-layer-btn:hover {
    background: #1e1e38;
  }
</style>
