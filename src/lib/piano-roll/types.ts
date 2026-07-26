export interface Note {
	id: string;
	midiNote: number;
	startBeat: number;
	durationBeats: number;
	velocity: number;
}

export interface Envelope {
	attack: number;
	decay: number;
	sustain: number;
	release: number;
}

export interface FilterSettings {
	enabled: boolean;
	cutoff: number;
	resonance: number;
}

export interface SynthSettings {
	waveform: OscillatorType;
	volume: number;
	envelope: Envelope;
	filter: FilterSettings;
}

export type SnapDenominator = 1 | 2 | 4 | 8 | 16;

export const NOTE_NAMES = [
	'C',
	'C#',
	'D',
	'D#',
	'E',
	'F',
	'F#',
	'G',
	'G#',
	'A',
	'A#',
	'B'
] as const;

export const MIN_MIDI = 36; // C2
export const MAX_MIDI = 107; // B7
export const NOTE_COUNT = MAX_MIDI - MIN_MIDI + 1; // 72

export function isBlackKey(midiNote: number): boolean {
	return [1, 3, 6, 8, 10].includes(midiNote % 12);
}

export function noteName(midiNote: number): string {
	const octave = Math.floor(midiNote / 12) - 1;
	return NOTE_NAMES[midiNote % 12] + octave;
}

export function midiToFreq(midiNote: number): number {
	return 440 * Math.pow(2, (midiNote - 69) / 12);
}
