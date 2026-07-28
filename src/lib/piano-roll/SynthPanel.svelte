<script lang="ts">
  import { getEditorState } from './context.svelte.js';
  const { store } = getEditorState();
  import type { SynthSettings } from './types.js';

  const WAVEFORMS: OscillatorType[] = ['sine', 'square', 'sawtooth', 'triangle'];

  interface Preset {
    name: string;
    settings: SynthSettings;
  }

  const PRESETS: Preset[] = [
    {
      name: 'Default',
      settings: {
        waveform: 'triangle',
        volume: 90,
        envelope: { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.3 },
        filter: { enabled: false, cutoff: 2000, resonance: 1 },
      },
    },
    {
      name: 'Piano',
      settings: {
        waveform: 'triangle',
        volume: 85,
        envelope: { attack: 0.005, decay: 0.3, sustain: 0.3, release: 0.8 },
        filter: { enabled: false, cutoff: 4000, resonance: 1 },
      },
    },
    {
      name: 'Pad',
      settings: {
        waveform: 'sine',
        volume: 75,
        envelope: { attack: 0.5, decay: 0.2, sustain: 0.8, release: 1.5 },
        filter: { enabled: true, cutoff: 800, resonance: 3 },
      },
    },
    {
      name: 'Lead',
      settings: {
        waveform: 'sawtooth',
        volume: 80,
        envelope: { attack: 0.01, decay: 0.05, sustain: 0.9, release: 0.2 },
        filter: { enabled: true, cutoff: 3000, resonance: 5 },
      },
    },
    {
      name: 'Bass',
      settings: {
        waveform: 'square',
        volume: 85,
        envelope: { attack: 0.005, decay: 0.15, sustain: 0.6, release: 0.15 },
        filter: { enabled: true, cutoff: 600, resonance: 2 },
      },
    },
  ];

  let selectedPreset = $state('');
  let showEnvelope = $state(true);
  let showFilter = $state(true);
  let showEffects = $state(false);

  function loadPreset(name: string) {
    const p = PRESETS.find((p) => p.name === name);
    if (p) {
      store.synthSettings = structuredClone(p.settings);
      selectedPreset = name;
    }
  }

  const envParams = [
    { key: 'attack', label: 'Attack', min: 0.001, max: 2, step: 0.001 },
    { key: 'decay', label: 'Decay', min: 0.001, max: 2, step: 0.001 },
    { key: 'sustain', label: 'Sustain', min: 0, max: 1, step: 0.01 },
    { key: 'release', label: 'Release', min: 0.001, max: 4, step: 0.001 },
  ] as const;
</script>

<div class="synth-panel">
  <!-- Preset -->
  <div class="section">
    <div class="section-label">Preset</div>
    <select
      class="select"
      value={selectedPreset}
      onchange={(e) => {
        loadPreset((e.target as HTMLSelectElement).value);
      }}
    >
      <option value="">Select a preset...</option>
      {#each PRESETS as p (p.name)}
        <option value={p.name}>{p.name}</option>
      {/each}
    </select>
  </div>

  <!-- Waveform -->
  <div class="section">
    <div class="section-label">Waveform</div>
    <select
      class="select"
      value={store.synthSettings.waveform}
      onchange={(e) => {
        store.synthSettings = {
          ...store.synthSettings,
          waveform: (e.target as HTMLSelectElement).value as OscillatorType,
        };
      }}
    >
      {#each WAVEFORMS as wf (wf)}
        <option value={wf}>{wf[0].toUpperCase() + wf.slice(1)}</option>
      {/each}
    </select>
  </div>

  <!-- Volume -->
  <div class="section">
    <div class="section-label">
      Volume
      <span class="value-badge">{store.synthSettings.volume}%</span>
    </div>
    <input
      class="slider"
      type="range"
      min="0"
      max="100"
      step="1"
      value={store.synthSettings.volume}
      oninput={(e) => {
        store.synthSettings = {
          ...store.synthSettings,
          volume: Number((e.target as HTMLInputElement).value),
        };
      }}
    />
  </div>

  <!-- Tempo -->
  <div class="section">
    <div class="section-label">
      Tempo
      <span class="value-badge">{store.tempo} BPM</span>
    </div>
    <input
      class="slider"
      type="range"
      min="40"
      max="240"
      step="1"
      value={store.tempo}
      oninput={(e) => {
        store.tempo = Number((e.target as HTMLInputElement).value);
      }}
    />
  </div>

  <!-- Envelope -->
  <div class="collapsible">
    <button
      class="collapsible-header"
      onclick={() => {
        showEnvelope = !showEnvelope;
      }}
      aria-expanded={showEnvelope}
    >
      <span class="chevron" class:open={showEnvelope}>›</span>
      ENVELOPE
    </button>

    {#if showEnvelope}
      <div class="collapsible-body">
        {#each envParams as param (param.key)}
          {@const val = store.synthSettings.envelope[param.key]}
          <div class="param-row">
            <span class="param-label">{param.label}</span>
            <input
              class="slider"
              type="range"
              min={param.min}
              max={param.max}
              step={param.step}
              value={val}
              oninput={(e) => {
                store.synthSettings = {
                  ...store.synthSettings,
                  envelope: {
                    ...store.synthSettings.envelope,
                    [param.key]: Number((e.target as HTMLInputElement).value),
                  },
                };
              }}
            />
            <span class="param-value">{val.toFixed(2)}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Filter -->
  <div class="collapsible">
    <div class="collapsible-head-row">
      <button
        class="collapsible-header"
        onclick={() => {
          showFilter = !showFilter;
        }}
        aria-expanded={showFilter}
      >
        <span class="chevron" class:open={showFilter}>›</span>
        FILTER
      </button>
      <div class="filter-toggle-wrap">
        <button
          type="button"
          class="toggle-pill"
          class:on={store.synthSettings.filter.enabled}
          role="switch"
          aria-checked={store.synthSettings.filter.enabled}
          aria-label="Toggle filter"
          onclick={() => {
            store.synthSettings = {
              ...store.synthSettings,
              filter: {
                ...store.synthSettings.filter,
                enabled: !store.synthSettings.filter.enabled,
              },
            };
          }}
        >
          <div class="toggle-knob"></div>
        </button>
      </div>
    </div>

    {#if showFilter}
      <div class="collapsible-body">
        <div class="param-row">
          <span class="param-label">Cutoff</span>
          <input
            class="slider"
            type="range"
            min="20"
            max="20000"
            step="10"
            value={store.synthSettings.filter.cutoff}
            oninput={(e) => {
              store.synthSettings = {
                ...store.synthSettings,
                filter: {
                  ...store.synthSettings.filter,
                  cutoff: Number((e.target as HTMLInputElement).value),
                },
              };
            }}
          />
          <span class="param-value">{store.synthSettings.filter.cutoff}Hz</span>
        </div>
        <div class="param-row">
          <span class="param-label">Resonance</span>
          <input
            class="slider"
            type="range"
            min="0"
            max="20"
            step="0.1"
            value={store.synthSettings.filter.resonance}
            oninput={(e) => {
              store.synthSettings = {
                ...store.synthSettings,
                filter: {
                  ...store.synthSettings.filter,
                  resonance: Number((e.target as HTMLInputElement).value),
                },
              };
            }}
          />
          <span class="param-value">{store.synthSettings.filter.resonance.toFixed(1)}</span>
        </div>
      </div>
    {/if}
  </div>

  <!-- Effects -->
  <div class="collapsible">
    <button
      class="collapsible-header"
      onclick={() => {
        showEffects = !showEffects;
      }}
      aria-expanded={showEffects}
    >
      <span class="chevron" class:open={showEffects}>›</span>
      EFFECTS
    </button>

    {#if showEffects}
      <div class="collapsible-body muted">Reverb and delay — coming soon</div>
    {/if}
  </div>
</div>

<style>
  .synth-panel {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  /* ── Sections ── */
  .section {
    padding: 10px 14px;
    border-bottom: 1px solid #222238;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .section-label {
    font-size: 11px;
    color: #888aaa;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .value-badge {
    font-size: 11px;
    color: #c0c0e0;
    font-weight: 600;
  }

  /* ── Controls ── */
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

  .slider {
    width: 100%;
    height: 4px;
    accent-color: #6b6bd9;
    cursor: pointer;
  }

  /* ── Collapsibles ── */
  .collapsible {
    border-bottom: 1px solid #222238;
  }

  .collapsible-head-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-right: 14px;
  }

  .collapsible-header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: auto;
    flex: 1;
    padding: 10px 14px;
    background: transparent;
    border: none;
    color: #888aaa;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.07em;
    cursor: pointer;
    text-align: left;
    transition: color 0.12s;
  }

  .collapsible-header:hover {
    color: #b0b0d0;
  }

  .chevron {
    display: inline-block;
    transition: transform 0.15s;
    font-size: 16px;
    line-height: 1;
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  .collapsible-body {
    padding: 4px 14px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .collapsible-body.muted {
    font-size: 11px;
    color: #555577;
    font-style: italic;
  }

  /* ── Param rows ── */
  .param-row {
    display: grid;
    grid-template-columns: 52px 1fr 40px;
    align-items: center;
    gap: 6px;
  }

  .param-label {
    font-size: 11px;
    color: #777799;
  }

  .param-value {
    font-size: 10px;
    color: #9090c0;
    text-align: right;
    white-space: nowrap;
  }

  /* ── Filter toggle ── */
  .filter-toggle-wrap {
    margin-left: auto;
    display: flex;
    align-items: center;
  }

  .toggle-pill {
    width: 28px;
    height: 16px;
    background: #333355;
    border: none;
    border-radius: 8px;
    padding: 2px;
    display: flex;
    align-items: center;
    cursor: pointer;
    transition: background 0.15s;
  }

  .toggle-pill:focus-visible {
    outline: 2px solid #6b6bd9;
    outline-offset: 2px;
  }

  .toggle-pill.on {
    background: #6b6bd9;
    justify-content: flex-end;
  }

  .toggle-knob {
    width: 12px;
    height: 12px;
    background: #fff;
    border-radius: 50%;
  }
</style>
