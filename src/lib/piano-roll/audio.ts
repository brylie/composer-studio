import { midiToFreq } from './types.js';
import type { Note, SynthSettings } from './types.js';

let _ctx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
	if (!_ctx) _ctx = new AudioContext();
	return _ctx;
}

export function triggerNote(
	midiNote: number,
	settings: SynthSettings,
	durationSec: number,
	atTime: number
): void {
	const ctx = getAudioContext();
	const osc = ctx.createOscillator();
	const gain = ctx.createGain();
	const vol = settings.volume / 100;
	const { attack, decay, sustain, release } = settings.envelope;

	osc.type = settings.waveform;
	osc.frequency.value = midiToFreq(midiNote);

	if (settings.filter.enabled) {
		const filter = ctx.createBiquadFilter();
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

	osc.start(t);
	osc.stop(releaseStart + release + 0.05);
}

export interface PlaybackOptions {
	getNotes: () => Note[];
	getSettings: () => SynthSettings;
	getTempo: () => number;
	startBeat: number;
	totalBeats: number;
	loopEnabled: boolean;
	onTick: (beat: number) => void;
	onStop: () => void;
}

let _intervalId: ReturnType<typeof setInterval> | null = null;
let _rafId: number | null = null;
let _startAudioTime = 0;
let _startBeat = 0;
let _scheduled = new Map<string, number>();
let _options: PlaybackOptions | null = null;

const LOOKAHEAD_SEC = 0.1;
const INTERVAL_MS = 25;

export function startPlayback(options: PlaybackOptions): void {
	stopPlayback();

	const ctx = getAudioContext();
	if (ctx.state === 'suspended') ctx.resume();

	_options = options;
	_startBeat = options.startBeat;
	_startAudioTime = ctx.currentTime;
	_scheduled.clear();

	function schedule(): void {
		if (!_options) return;
		const ctx = getAudioContext();
		const { getNotes, getSettings, getTempo, totalBeats, loopEnabled } = _options;
		const bps = getTempo() / 60;
		const elapsed = ctx.currentTime - _startAudioTime;
		const currentBeat = _startBeat + elapsed * bps;
		const windowEnd = currentBeat + LOOKAHEAD_SEC * bps;

		const notes = getNotes();
		const settings = getSettings();

		const maxLoops = loopEnabled ? Math.ceil(windowEnd / totalBeats) + 1 : 1;

		for (const note of notes) {
			for (let loop = 0; loop < maxLoops; loop++) {
				const noteBeat = note.startBeat + loop * totalBeats;
				if (noteBeat < currentBeat - 0.01) continue;
				if (noteBeat > windowEnd) continue;

				const key = `${note.id}:${loop}`;
				if (_scheduled.has(key)) continue;
				_scheduled.set(key, loop);

				const noteStartTime = _startAudioTime + (noteBeat - _startBeat) / bps;
				const durationSec = note.durationBeats / bps;
				triggerNote(note.midiNote, settings, durationSec, noteStartTime);
			}
		}
	}

	_intervalId = setInterval(schedule, INTERVAL_MS);

	function tick(): void {
		if (!_options) return;
		const ctx = getAudioContext();
		const bps = _options.getTempo() / 60;
		const elapsed = ctx.currentTime - _startAudioTime;
		let beat = _startBeat + elapsed * bps;

		if (_options.loopEnabled) {
			beat = beat % _options.totalBeats;
		} else if (beat >= _options.totalBeats) {
			stopPlayback();
			_options?.onStop();
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
	if (ctx.state === 'suspended') ctx.resume();
	triggerNote(midiNote, settings, 0.5, ctx.currentTime);
}
