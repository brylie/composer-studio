import type { Note, SynthSettings } from './types.js';
import { midiToFreq } from './types.js';

let _ctx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  _ctx ??= new AudioContext();
  return _ctx;
}

export function triggerNote(
  midiNote: number,
  settings: SynthSettings,
  durationSec: number,
  atTime: number,
): void {
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const vol = settings.volume / 100;
  const { attack, decay, sustain, release } = settings.envelope;

  osc.type = settings.waveform;
  osc.frequency.value = midiToFreq(midiNote);

  let filter: BiquadFilterNode | null = null;
  if (settings.filter.enabled) {
    filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = settings.filter.cutoff;
    filter.Q.value = settings.filter.resonance;
    osc.connect(filter);
    filter.connect(gain);
  } else {
    osc.connect(gain);
  }
  gain.connect(ctx.destination);

  const t = atTime;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(vol, t + attack);
  gain.gain.linearRampToValueAtTime(vol * sustain, t + attack + decay);

  const releaseStart = Math.max(t + attack + decay, t + durationSec - release);
  gain.gain.setValueAtTime(vol * sustain, releaseStart);
  gain.gain.linearRampToValueAtTime(0, releaseStart + release);

  osc.onended = () => {
    gain.disconnect(ctx.destination);
    filter?.disconnect();
  };

  osc.start(t);
  osc.stop(releaseStart + release + 0.05);
}

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

let _intervalId: ReturnType<typeof setInterval> | null = null;
let _rafId: number | null = null;
let _startAudioTime = 0;
let _startBeat = 0;
const _scheduled = new Map<string, number>();
let _options: PlaybackOptions | null = null;

const LOOKAHEAD_SEC = 0.1;
const INTERVAL_MS = 25;

export function startPlayback(options: PlaybackOptions): void {
  stopPlayback();

  const ctx = getAudioContext();
  if (ctx.state === 'suspended') void ctx.resume();

  _options = options;
  _startBeat = options.startBeat;
  _startAudioTime = ctx.currentTime;
  _scheduled.clear();

  function schedule(): void {
    if (!_options) return;
    const ctx = getAudioContext();
    const { getNotes, getSettings, getTempo, getTotalBeats, getLoopEnabled } = _options;
    const bps = getTempo() / 60;
    const totalBeats = Math.max(0.001, getTotalBeats());
    const loopEnabled = getLoopEnabled();
    const elapsed = ctx.currentTime - _startAudioTime;
    const currentBeat = _startBeat + elapsed * bps;
    const windowEnd = currentBeat + LOOKAHEAD_SEC * bps;

    const notes = getNotes();
    const settings = getSettings();

    const minLoop = loopEnabled ? Math.max(0, Math.floor((currentBeat - 0.01) / totalBeats)) : 0;
    const maxLoop = loopEnabled ? minLoop + 1 : 0;

    // Keep only loops in the active scheduling window to avoid unbounded growth.
    for (const [key, loop] of _scheduled) {
      if (loop < minLoop || loop > maxLoop) {
        _scheduled.delete(key);
      }
    }

    for (const note of notes) {
      for (let loop = minLoop; loop <= maxLoop; loop++) {
        const noteBeat = note.startBeat + loop * totalBeats;
        if (noteBeat < currentBeat - 0.01) continue;
        if (noteBeat > windowEnd) continue;

        const key = `${note.id}:${String(loop)}`;
        if (_scheduled.has(key)) continue;
        _scheduled.set(key, loop);

        const noteStartTime = _startAudioTime + (noteBeat - _startBeat) / bps;
        const durationSec = note.durationBeats / bps;
        triggerNote(note.midiNote, settings, durationSec, noteStartTime);
      }
    }
  }

  schedule();
  _intervalId = setInterval(schedule, INTERVAL_MS);

  function tick(): void {
    if (!_options) return;
    const ctx = getAudioContext();
    const bps = _options.getTempo() / 60;
    const totalBeats = Math.max(0.001, _options.getTotalBeats());
    const elapsed = ctx.currentTime - _startAudioTime;
    let beat = _startBeat + elapsed * bps;

    if (_options.getLoopEnabled()) {
      beat = beat % totalBeats;
    } else if (beat >= totalBeats) {
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
  if (_intervalId !== null) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
  if (_rafId !== null) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }
  _scheduled.clear();
  _options = null;
}

export function auditionNote(midiNote: number, settings: SynthSettings): void {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  triggerNote(midiNote, settings, 0.5, ctx.currentTime);
}
