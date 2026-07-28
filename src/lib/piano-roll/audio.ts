import * as Tone from 'tone';
import type { Note, SynthSettings } from './types.js';
import { midiToFreq } from './types.js';

// ── Shared instrument (libraries.md#mvp-default-instrument-tonepolysynth-over-tonesynth) ──
//
// One Tone.PolySynth("piano") for the whole document, routed through a single
// shared post-synth Tone.Filter — not a per-voice filter, matching the Sound
// drawer's one Cutoff/Resonance pair. Created lazily since Tone can't touch
// the audio context before a user gesture.

let _piano: Tone.PolySynth | null = null;
let _filter: Tone.Filter | null = null;
let _filterEnabled = false;

function getPiano(): { piano: Tone.PolySynth; filter: Tone.Filter } {
  if (!_piano || !_filter) {
    _filter = new Tone.Filter({ frequency: 4000, Q: 1, type: 'lowpass' }).toDestination();
    _piano = new Tone.PolySynth(Tone.Synth).toDestination();
  }
  return { piano: _piano, filter: _filter };
}

function applySettings(settings: SynthSettings): void {
  const { piano, filter } = getPiano();
  piano.set({
    oscillator: { type: settings.waveform },
    envelope: settings.envelope,
  });
  piano.volume.value = Tone.gainToDb(Math.max(0.0001, settings.volume / 100));
  filter.frequency.value = settings.filter.cutoff;
  filter.Q.value = settings.filter.resonance;

  if (settings.filter.enabled !== _filterEnabled) {
    _filterEnabled = settings.filter.enabled;
    piano.disconnect();
    if (_filterEnabled) {
      piano.connect(filter);
    } else {
      piano.toDestination();
    }
  }
}

export function triggerNote(
  midiNote: number,
  settings: SynthSettings,
  durationSec: number,
  atTime: number,
): void {
  applySettings(settings);
  const { piano } = getPiano();
  piano.triggerAttackRelease(midiToFreq(midiNote), durationSec, atTime);
}

export function auditionNote(midiNote: number, settings: SynthSettings): void {
  void Tone.start();
  applySettings(settings);
  const { piano } = getPiano();
  piano.triggerAttackRelease(midiToFreq(midiNote), 0.5);
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
  getSettings: () => SynthSettings;
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
    const { getNotes, getSettings, getTempo, getTotalBeats, getLoopEnabled } = _options;

    transport.bpm.value = getTempo();
    const totalBeats = Math.max(0.001, getTotalBeats());
    const loopEnabled = getLoopEnabled();
    transport.loop = loopEnabled;
    transport.loopStart = 0;
    transport.loopEnd = totalBeats * (60 / transport.bpm.value);

    applySettings(getSettings());
    const { piano } = getPiano();

    const bps = transport.bpm.value / 60;
    const currentBeat = transport.getTicksAtTime(time) / transport.PPQ;
    const windowEnd = currentBeat + LOOKAHEAD_SEC * bps;

    for (const [key, pass] of _scheduled) {
      if (pass < _loopPass) _scheduled.delete(key);
    }

    const notes = getNotes();

    function scheduleWindow(windowStart: number, windowStop: number, pass: number): void {
      for (const note of notes) {
        if (note.startBeat < windowStart - 0.01 || note.startBeat > windowStop) continue;
        const key = `${note.id}:${String(pass)}`;
        if (_scheduled.has(key)) continue;
        _scheduled.set(key, pass);

        const beatsFromNow = note.startBeat - currentBeat + (pass - _loopPass) * totalBeats;
        const noteTime = time + beatsFromNow / bps;
        const durationSec = note.durationBeats / bps;
        piano.triggerAttackRelease(midiToFreq(note.midiNote), durationSec, noteTime);
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
  // Guard against touching Tone's global transport when nothing is playing —
  // e.g. Toolbar's onDestroy calls this unconditionally, and onDestroy also
  // runs during SSR (unlike onMount), where there's no AudioContext at all.
  if (_options === null && _scheduleEventId === null && _rafId === null) return;

  const transport = Tone.getTransport();
  if (_scheduleEventId !== null) {
    transport.clear(_scheduleEventId);
    _scheduleEventId = null;
  }
  transport.off('loop', handleTransportLoop);
  transport.stop();
  _piano?.releaseAll();

  if (_rafId !== null) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }
  _scheduled.clear();
  _options = null;
}
