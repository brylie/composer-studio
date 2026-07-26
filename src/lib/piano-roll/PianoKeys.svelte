<script lang="ts">
	import { store } from './store.svelte.js';
	import { isBlackKey, noteName, MIN_MIDI, MAX_MIDI, NOTE_COUNT } from './types.js';
	import { auditionNote } from './audio.js';

	// Notes displayed from high (top) to low (bottom)
	const noteRange = Array.from({ length: NOTE_COUNT }, (_, i) => MAX_MIDI - i);

	const activeNotes = $derived(
		store.isPlaying
			? new Set(
					store.notes
						.filter(
							(n) =>
								n.startBeat <= store.currentBeat &&
								n.startBeat + n.durationBeats > store.currentBeat
						)
						.map((n) => n.midiNote)
				)
			: new Set<number>()
	);

	const totalHeight = $derived(NOTE_COUNT * store.rowHeight);
</script>

<div
	class="piano-keys"
	style="width: 64px; height: {totalHeight}px; position: sticky; left: 0; z-index: 10; flex-shrink: 0;"
>
	{#each noteRange as midi}
		{@const black = isBlackKey(midi)}
		{@const isC = midi % 12 === 0}
		{@const active = activeNotes.has(midi)}
		<button
			class="key"
			class:black-key={black}
			class:white-key={!black}
			class:c-note={isC}
			class:active
			style="height: {store.rowHeight}px;"
			onclick={() => auditionNote(midi, store.synthSettings)}
			aria-label={noteName(midi)}
		>
			<span class="label">{noteName(midi)}</span>
		</button>
	{/each}
</div>

<style>
	.piano-keys {
		background: #111120;
		border-right: 1px solid #2a2a45;
		overflow: hidden;
	}

	.key {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		width: 100%;
		padding: 0 5px;
		border: none;
		border-bottom: 1px solid #1a1a2e;
		cursor: pointer;
		box-sizing: border-box;
		transition: background 0.07s;
	}

	.white-key {
		background: #1e1e34;
		color: #6666aa;
	}

	.black-key {
		background: #0d0d1c;
		color: #444466;
	}

	.c-note {
		border-top: 1px solid #3a3a60;
	}

	.key.active,
	.key:hover {
		background: #5555c0;
		color: #fff;
	}

	.label {
		font-size: 9px;
		font-family: 'Courier New', monospace;
		pointer-events: none;
		white-space: nowrap;
	}
</style>
