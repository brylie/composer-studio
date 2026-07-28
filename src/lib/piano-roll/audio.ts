import * as Tone from 'tone';
import type { Note, SynthSettings } from './types.js';
import { midiToFreq } from './types.js';

// ── Per-layer instruments (layers.md#audio) ─────────────────────────────────
//
// One Tone.PolySynth("piano") per layer, each routed through its own
// post-synth Tone.Filter — layers.md: "One Tone.Sampler/Tone.PolySynth
// instance per layer, each built from that layer's instrument settings."
// Instances are keyed by layerId and created lazily (per layer, since Tone
// can't touch the audio context before a user gesture, same as the
// pre-layers single-instrument version this replaces).

interface Instrument {
  synth: Tone.PolySynth;
  filter: Tone.Filter;
  filterEnabled: boolean;
  /** Last settings fully applied to this instance, so unchanged settings can be skipped. */
  lastSettings: SynthSettings | null;
}

const _instruments = new Map<string, Instrument>();

function getInstrument(layerId: string): Instrument {
  let instrument = _instruments.get(layerId);
  if (!instrument) {
    const filter = new Tone.Filter({ frequency: 4000, Q: 1, type: 'lowpass' }).toDestination();
    const synth = new Tone.PolySynth(Tone.Synth).toDestination();
    instrument = { synth, filter, filterEnabled: false, lastSettings: null };
    _instruments.set(layerId, instrument);
  }
  return instrument;
}

function applySettings(layerId: string, settings: SynthSettings): Instrument {
  const instrument = getInstrument(layerId);
  const { synth, filter } = instrument;
  const last = instrument.lastSettings;

  if (
    last !== null &&
    last.waveform === settings.waveform &&
    last.volume === settings.volume &&
    last.envelope.attack === settings.envelope.attack &&
    last.envelope.decay === settings.envelope.decay &&
    last.envelope.sustain === settings.envelope.sustain &&
    last.envelope.release === settings.envelope.release &&
    last.filter.cutoff === settings.filter.cutoff &&
    last.filter.resonance === settings.filter.resonance &&
    settings.filter.enabled === instrument.filterEnabled
  ) {
    return instrument;
  }

  if (last?.waveform !== settings.waveform) {
    synth.set({ oscillator: { type: settings.waveform } });
  }
  if (
    last?.envelope.attack !== settings.envelope.attack ||
    last.envelope.decay !== settings.envelope.decay ||
    last.envelope.sustain !== settings.envelope.sustain ||
    last.envelope.release !== settings.envelope.release
  ) {
    synth.set({ envelope: settings.envelope });
  }
  if (last?.volume !== settings.volume) {
    synth.volume.value = Tone.gainToDb(Math.max(0.0001, settings.volume / 100));
  }
  if (last?.filter.cutoff !== settings.filter.cutoff) {
    filter.frequency.value = settings.filter.cutoff;
  }
  if (last?.filter.resonance !== settings.filter.resonance) {
    filter.Q.value = settings.filter.resonance;
  }

  if (settings.filter.enabled !== instrument.filterEnabled) {
    instrument.filterEnabled = settings.filter.enabled;
    synth.disconnect();
    if (instrument.filterEnabled) {
      synth.connect(filter);
    } else {
      synth.toDestination();
    }
  }

  instrument.lastSettings = settings;
  return instrument;
}

export function triggerNote(
  layerId: string,
  midiNote: number,
  settings: SynthSettings,
  durationSec: number,
  atTime: number,
): void {
  const { synth } = applySettings(layerId, settings);
  synth.triggerAttackRelease(midiToFreq(midiNote), durationSec, atTime);
}

export function auditionNote(layerId: string, midiNote: number, settings: SynthSettings): void {
  void Tone.start();
  const { synth } = applySettings(layerId, settings);
  synth.triggerAttackRelease(midiToFreq(midiNote), 0.5);
}

/**
 * Disposes a single layer's synth/filter and drops its map entry — called
 * when a layer is deleted (store.svelte.ts's removeLayer) so an audition-only
 * or playback instrument for a since-deleted layer doesn't linger forever.
 */
export function disposeLayer(layerId: string): void {
  const instrument = _instruments.get(layerId);
  if (!instrument) return;
  instrument.synth.dispose();
  instrument.filter.dispose();
  _instruments.delete(layerId);
}

/** Disposes every layer's instrument, regardless of playback state. */
function disposeAllInstruments(): void {
  for (const instrument of _instruments.values()) {
    instrument.synth.dispose();
    instrument.filter.dispose();
  }
  _instruments.clear();
}

// ── Playback scheduler ───────────────────────────────────────────────────────
//
// Tone.Transport replaces the old setInterval/lookahead scheduler: it's a
// drift-corrected clock driven off the audio context itself, and its native
// loop/loopStart/loopEnd wraps the transport's own position for us instead of
// this module doing the min/maxLoop-iteration math by hand. loopStart is
// always 0 today — the Ruler's adjustable loop points are a planned feature
// (audio-engine.md#loop-handling), not implemented yet.

export interface PlaybackOptions {
  getNotes: () => Note[];
  /** Looks up the instrument settings for a given note's layer (layers.md#audio) — one instrument per layer, not one document-wide instrument. */
  getLayerSettings: (layerId: string) => SynthSettings;
  getTempo: () => number;
  getTotalBeats: () => number;
  getLoopEnabled: () => boolean;
  startBeat: number;
  onTick: (beat: number) => void;
  onStop: () => void;
}

const LOOKAHEAD_SEC = 0.1;
const SCAN_INTERVAL_SEC = 0.025;

let _scheduleEventId: number | null = null;
let _rafId: number | null = null;
let _options: PlaybackOptions | null = null;

/** Bumped each time the transport wraps, so notes near the loop boundary are keyed per-pass and can't double-trigger. */
let _loopPass = 0;
/** `${noteId}:${pass}` → pass, so stale passes can be pruned without scanning the whole document each tick. */
const _scheduled = new Map<string, number>();

function handleTransportLoop(): void {
  _loopPass++;
}

export function startPlayback(options: PlaybackOptions): void {
  stopPlayback();
  void Tone.start();

  const transport = Tone.getTransport();
  _options = options;
  _loopPass = 0;
  _scheduled.clear();

  transport.bpm.value = options.getTempo();
  transport.ticks = Math.round(options.startBeat * transport.PPQ);
  transport.on('loop', handleTransportLoop);

  function scan(time: number): void {
    if (!_options) return;
    const { getNotes, getLayerSettings, getTempo, getTotalBeats, getLoopEnabled } = _options;

    transport.bpm.value = getTempo();
    const totalBeats = Math.max(0.001, getTotalBeats());
    const loopEnabled = getLoopEnabled();
    transport.loop = loopEnabled;
    transport.loopStart = 0;
    transport.loopEnd = totalBeats * (60 / transport.bpm.value);

    const notes = getNotes();
    // One instrument per layer (layers.md#audio) — refresh every layer
    // represented in this pass's notes, not just a single shared instrument.
    for (const layerId of new Set(notes.map((n) => n.layerId))) {
      applySettings(layerId, getLayerSettings(layerId));
    }

    const bps = transport.bpm.value / 60;
    const currentBeat = transport.getTicksAtTime(time) / transport.PPQ;
    const windowEnd = currentBeat + LOOKAHEAD_SEC * bps;

    for (const [key, pass] of _scheduled) {
      if (pass < _loopPass) _scheduled.delete(key);
    }

    function scheduleWindow(windowStart: number, windowStop: number, pass: number): void {
      for (const note of notes) {
        if (note.startBeat < windowStart - 0.01 || note.startBeat > windowStop) continue;
        const key = `${note.id}:${String(pass)}`;
        if (_scheduled.has(key)) continue;
        _scheduled.set(key, pass);

        const beatsFromNow = note.startBeat - currentBeat + (pass - _loopPass) * totalBeats;
        const noteTime = time + beatsFromNow / bps;
        const durationSec = note.durationBeats / bps;
        const { synth } = getInstrument(note.layerId);
        synth.triggerAttackRelease(midiToFreq(note.midiNote), durationSec, noteTime);
      }
    }

    scheduleWindow(currentBeat, Math.min(windowEnd, totalBeats), _loopPass);
    if (loopEnabled && windowEnd > totalBeats) {
      scheduleWindow(0, windowEnd - totalBeats, _loopPass + 1);
    }
  }

  scan(Tone.now());
  _scheduleEventId = transport.scheduleRepeat(scan, SCAN_INTERVAL_SEC);
  transport.start();

  function tick(): void {
    if (!_options) return;
    const beat = transport.ticks / transport.PPQ;
    const totalBeats = Math.max(0.001, _options.getTotalBeats());

    if (!_options.getLoopEnabled() && beat >= totalBeats) {
      const onStop = _options.onStop;
      stopPlayback();
      onStop();
      return;
    }

    _options.onTick(beat);
    _rafId = requestAnimationFrame(tick);
  }

  _rafId = requestAnimationFrame(tick);
}

export function stopPlayback(): void {
  // Guard the transport-touching calls (not instrument disposal below) when
  // nothing is playing — e.g. Toolbar's onDestroy calls this unconditionally,
  // and onDestroy also runs during SSR (unlike onMount), where there's no
  // AudioContext at all.
  const transportActive = _options !== null || _scheduleEventId !== null || _rafId !== null;
  if (transportActive) {
    const transport = Tone.getTransport();
    if (_scheduleEventId !== null) {
      transport.clear(_scheduleEventId);
      _scheduleEventId = null;
    }
    transport.off('loop', handleTransportLoop);
    transport.stop();
  }

  // releaseAll() follows the configured release envelope (up to 4s, per the
  // Sound drawer), so it can't guarantee immediate silence — including for
  // attacks already scheduled inside the lookahead window. Disposing every
  // layer's instrument forces a hard cutoff regardless of envelope/schedule;
  // getInstrument()/applySettings() lazily recreate and fully reconfigure
  // each one (oscillator, envelope, volume, filter routing) on next trigger.
  // Unconditional (not gated on transportActive) so audition-only instruments
  // — created without ever starting playback — are cleared too, e.g. on
  // editor teardown.
  disposeAllInstruments();

  if (_rafId !== null) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }
  _scheduled.clear();
  _options = null;
}
