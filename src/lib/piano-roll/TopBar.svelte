<script lang="ts">
  import { getEditorState } from './context.svelte.js';
  import Icon from './Icon.svelte';
  import { exportMidi } from './midi-export.js';

  const { store, ribbonUi } = getEditorState();

  function formatSnap(denominator: number): string {
    return denominator === 1 ? '1' : `1/${String(denominator)}`;
  }

  function goBack() {
    history.back();
  }

  function handleExport() {
    exportMidi(store.notes, store.tempo, `${store.trackName}.mid`);
  }
</script>

<header class="top-bar">
  <button class="icon-btn" onclick={goBack} aria-label="Back">
    <Icon name="back" />
  </button>

  <div class="track-info">
    <span
      class="track-name"
      contenteditable="true"
      onblur={(e) => {
        const el = e.target as HTMLElement;
        const trimmed = (el.textContent || '').trim();
        if (trimmed) {
          store.trackName = trimmed;
        } else {
          el.textContent = store.trackName;
        }
      }}
      onkeydown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLElement).blur();
        }
      }}
      role="textbox"
      aria-label="Track name"
      tabindex="0">{store.trackName}</span
    >
    <span class="subtitle">{store.tempo} BPM · {formatSnap(store.snapDenominator)}</span>
  </div>

  <div class="spacer"></div>

  <button
    class="quick-apply-btn"
    onclick={() => (ribbonUi.quickApplyOpen = true)}
    disabled={store.commandContext.count === 0}
    aria-label="Quick apply to selection"
    title={store.commandContext.count === 0
      ? 'Select notes to quick-apply an operation'
      : 'Quick apply a command or generator to the selection'}
  >
    <Icon name="bolt" />
    <span class="quick-apply-label">Quick Apply</span>
  </button>

  <button class="export-btn" onclick={handleExport} aria-label="Export MIDI" title="Export MIDI">
    <Icon name="export" />
    <span class="export-label">Export MIDI</span>
  </button>

  <div class="chrome-group" role="group" aria-label="View options">
    <button
      class="icon-btn"
      class:active={ribbonUi.previewMode}
      onclick={() => {
        ribbonUi.previewMode = !ribbonUi.previewMode;
      }}
      aria-pressed={ribbonUi.previewMode}
      aria-label={ribbonUi.previewMode ? 'Exit preview mode' : 'Preview mode'}
      title="Hide editing chrome"
    >
      <Icon name="eye" />
    </button>
    <button
      class="icon-btn"
      class:active={ribbonUi.ribbonOpen}
      onclick={() => {
        ribbonUi.ribbonOpen = !ribbonUi.ribbonOpen;
      }}
      aria-pressed={ribbonUi.ribbonOpen}
      aria-label={ribbonUi.ribbonOpen ? 'Hide command ribbon' : 'Show command ribbon'}
      title="Toggle command ribbon"
    >
      <Icon name="tools" />
    </button>
    <button
      class="icon-btn"
      class:active={ribbonUi.soundDrawerOpen}
      onclick={() => {
        ribbonUi.soundDrawerOpen = !ribbonUi.soundDrawerOpen;
      }}
      aria-pressed={ribbonUi.soundDrawerOpen}
      aria-label={ribbonUi.soundDrawerOpen ? 'Close sound drawer' : 'Open sound drawer'}
      title="Sound settings"
    >
      <Icon name="sound" />
    </button>
    <button
      class="icon-btn"
      class:active={ribbonUi.layerPanelOpen}
      onclick={() => {
        ribbonUi.layerPanelOpen = !ribbonUi.layerPanelOpen;
      }}
      aria-pressed={ribbonUi.layerPanelOpen}
      aria-label={ribbonUi.layerPanelOpen ? 'Close layer panel' : 'Open layer panel'}
      title="Layers"
    >
      <Icon name="layers" />
    </button>
  </div>
</header>

<style>
  .top-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 12px;
    height: var(--top-bar-height);
    background: #0f0f1e;
    border-bottom: 1px solid #222238;
    flex-shrink: 0;
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: #9090c0;
    cursor: pointer;
    transition:
      background 0.12s,
      color 0.12s;
  }

  .icon-btn:hover {
    background: #232338;
    color: #d0d0f0;
  }

  .icon-btn.active {
    background: #26264a;
    color: #b0b0e8;
  }

  .track-info {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }

  .track-name {
    font-size: 14px;
    font-weight: 600;
    color: #d0d0f0;
    outline: none;
    border-radius: 3px;
    padding: 1px 4px;
    cursor: text;
    white-space: nowrap;
  }

  .track-name:focus {
    background: #1e1e38;
    outline: 1px solid #6b6bd9;
  }

  .subtitle {
    font-size: 11px;
    color: #666888;
    white-space: nowrap;
  }

  .spacer {
    flex: 1;
  }

  .export-btn,
  .quick-apply-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 14px;
    background: #2a2a45;
    border: 1px solid #3a3a60;
    border-radius: 6px;
    color: #d0d0f0;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.12s;
  }

  .export-btn:hover,
  .quick-apply-btn:hover:not(:disabled) {
    background: #35355a;
  }

  .quick-apply-btn {
    background: #4a3f8f;
    border-color: #6b6bd9;
  }

  .quick-apply-btn:hover:not(:disabled) {
    background: #5a4fae;
  }

  .quick-apply-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .chrome-group {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
  }

  @media (max-width: 599px) {
    .subtitle {
      display: none;
    }

    .track-info {
      flex: 1;
      min-width: 0;
    }

    .track-name {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
    }

    .export-label,
    .quick-apply-label {
      display: none;
    }

    .export-btn,
    .quick-apply-btn {
      padding: 6px;
    }
  }
</style>
