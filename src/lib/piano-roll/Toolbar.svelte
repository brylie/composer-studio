<script lang="ts">
	import { store } from './store.svelte.js';
	import { startPlayback, stopPlayback } from './audio.js';
	import { exportMidi } from './midi-export.js';

	const SNAP_OPTIONS = [1, 2, 4, 8, 16] as const;

	function formatTime(beat: number): string {
		const bar = Math.floor(beat / 4) + 1;
		const b = Math.floor(beat % 4) + 1;
		const ticks = Math.floor((beat % 1) * 100);
		return `${bar}:${b}:${String(ticks).padStart(2, '0')}`;
	}

	function togglePlay() {
		if (store.isPlaying) {
			stopPlayback();
			store.isPlaying = false;
		} else {
			store.isPlaying = true;
			startPlayback({
				getNotes: () => store.notes,
				getSettings: () => store.synthSettings,
				getTempo: () => store.tempo,
				getTotalBeats: () => store.totalBeats,
				getLoopEnabled: () => store.loopEnabled,
				startBeat: store.currentBeat,
				onTick: (beat) => {
					store.currentBeat = beat;
				},
				onStop: () => {
					store.isPlaying = false;
				}
			});
		}
	}

	function stopAndReset() {
		stopPlayback();
		store.isPlaying = false;
		store.currentBeat = 0;
	}

	function handleClearAll() {
		if (confirm('Remove all notes?')) {
			store.snapshotForUndo();
			store.clearNotes();
		}
	}

	function handleExport() {
		exportMidi(store.notes, store.tempo, `${store.trackName}.mid`);
	}

	// Keyboard shortcuts
	$effect(() => {
		function handleKey(e: KeyboardEvent) {
			const target = e.target as HTMLElement;
			if (
				target.tagName === 'INPUT' ||
				target.tagName === 'SELECT' ||
				target.tagName === 'TEXTAREA' ||
				target.isContentEditable
			)
				return;
			if (e.code === 'Space') {
				e.preventDefault();
				togglePlay();
			}
			if (e.code === 'Escape') {
				stopAndReset();
				store.deselectAll();
			}
			if (e.code === 'Equal' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				store.pixelsPerBeat = Math.min(240, store.pixelsPerBeat + 20);
			}
			if (e.code === 'Minus' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				store.pixelsPerBeat = Math.max(20, store.pixelsPerBeat - 20);
			}
			if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				if (e.shiftKey) {
					store.redo();
				} else {
					store.undo();
				}
			}
			if (e.code === 'KeyY' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				store.redo();
			}
			if (e.code === 'KeyA' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				store.selectAll();
			}
			if (e.code === 'Delete' || e.code === 'Backspace') {
				e.preventDefault();
				store.deleteSelected();
			}
		}
		document.addEventListener('keydown', handleKey);
		return () => document.removeEventListener('keydown', handleKey);
	});
</script>

<div class="toolbar">
	<!-- Transport -->
	<div class="transport">
		<button
			class="icon-btn play-btn"
			class:playing={store.isPlaying}
			onclick={togglePlay}
			aria-label={store.isPlaying ? 'Pause' : 'Play'}
		>
			{#if store.isPlaying}
				<!-- Pause icon -->
				<svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
					<rect x="2" y="1" width="3" height="11" rx="1" fill="currentColor" />
					<rect x="8" y="1" width="3" height="11" rx="1" fill="currentColor" />
				</svg>
			{:else}
				<!-- Play icon -->
				<svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
					<polygon points="2,1 12,6.5 2,12" fill="currentColor" />
				</svg>
			{/if}
		</button>

		<button class="icon-btn" onclick={stopAndReset} aria-label="Stop">
			<svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
				<rect x="2" y="2" width="9" height="9" rx="1" fill="currentColor" />
			</svg>
		</button>

		<button
			class="icon-btn rec-btn"
			class:recording={store.isRecording}
			onclick={() => {
				store.isRecording = !store.isRecording;
			}}
			aria-label="Record"
		>
			<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
				<circle cx="6" cy="6" r="5" fill="currentColor" />
			</svg>
		</button>

		<!-- Loop toggle -->
		<button
			class="icon-btn loop-btn"
			class:active={store.loopEnabled}
			onclick={() => {
				store.loopEnabled = !store.loopEnabled;
			}}
			aria-label={store.loopEnabled ? 'Disable loop' : 'Enable loop'}
			title={store.loopEnabled ? 'Loop on' : 'Loop off'}
		>
			<svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
				<path
					d="M1.5 6.5C1.5 3.74 3.74 1.5 6.5 1.5c1.46 0 2.78.56 3.76 1.47"
					fill="none"
					stroke="currentColor"
					stroke-width="1.4"
					stroke-linecap="round"
				/>
				<path
					d="M11.5 6.5C11.5 9.26 9.26 11.5 6.5 11.5c-1.46 0-2.78-.56-3.76-1.47"
					fill="none"
					stroke="currentColor"
					stroke-width="1.4"
					stroke-linecap="round"
				/>
				<polyline
					points="9,1 11.5,3 9,5"
					fill="none"
					stroke="currentColor"
					stroke-width="1.4"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
				<polyline
					points="4,8 1.5,10 4,12"
					fill="none"
					stroke="currentColor"
					stroke-width="1.4"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</button>
	</div>

	<!-- Time display -->
	<div class="time-display" aria-label="Playback position">
		{formatTime(store.currentBeat)}
	</div>

	<!-- Snap controls -->
	<div class="snap-group" role="group" aria-label="Snap grid">
		<svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true" class="snap-icon">
			<rect x="1" y="1" width="5" height="5" fill="none" stroke="currentColor" stroke-width="1.3" />
			<rect x="9" y="1" width="5" height="5" fill="none" stroke="currentColor" stroke-width="1.3" />
			<rect x="1" y="9" width="5" height="5" fill="none" stroke="currentColor" stroke-width="1.3" />
			<rect x="9" y="9" width="5" height="5" fill="none" stroke="currentColor" stroke-width="1.3" />
		</svg>

		<!-- Snap toggle pill -->
		<button
			class="snap-pill"
			onclick={() => {
				/* snap always on in MVP */
			}}
			aria-label="Snap enabled"
		>
			<div class="snap-knob"></div>
		</button>

		<span class="snap-label">Snap</span>

		{#each SNAP_OPTIONS as denom}
			<button
				class="snap-btn"
				class:active={store.snapDenominator === denom}
				onclick={() => {
					store.snapDenominator = denom;
				}}
			>
				{denom === 1 ? '1' : `1/${denom}`}
			</button>
		{/each}
	</div>

	<!-- Zoom controls -->
	<div class="zoom-group" role="group" aria-label="Zoom">
		<button
			class="icon-btn"
			onclick={() => {
				store.pixelsPerBeat = Math.max(20, store.pixelsPerBeat - 20);
			}}
			aria-label="Zoom out"
			title="Zoom out (Ctrl+−)"
		>
			<svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
				<circle cx="5.5" cy="5.5" r="4" fill="none" stroke="currentColor" stroke-width="1.3" />
				<line
					x1="3.5"
					y1="5.5"
					x2="7.5"
					y2="5.5"
					stroke="currentColor"
					stroke-width="1.3"
					stroke-linecap="round"
				/>
				<line
					x1="9"
					y1="9"
					x2="12"
					y2="12"
					stroke="currentColor"
					stroke-width="1.3"
					stroke-linecap="round"
				/>
			</svg>
		</button>
		<button
			class="icon-btn"
			onclick={() => {
				store.pixelsPerBeat = Math.min(240, store.pixelsPerBeat + 20);
			}}
			aria-label="Zoom in"
			title="Zoom in (Ctrl++)"
		>
			<svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
				<circle cx="5.5" cy="5.5" r="4" fill="none" stroke="currentColor" stroke-width="1.3" />
				<line
					x1="5.5"
					y1="3.5"
					x2="5.5"
					y2="7.5"
					stroke="currentColor"
					stroke-width="1.3"
					stroke-linecap="round"
				/>
				<line
					x1="3.5"
					y1="5.5"
					x2="7.5"
					y2="5.5"
					stroke="currentColor"
					stroke-width="1.3"
					stroke-linecap="round"
				/>
				<line
					x1="9"
					y1="9"
					x2="12"
					y2="12"
					stroke="currentColor"
					stroke-width="1.3"
					stroke-linecap="round"
				/>
			</svg>
		</button>
	</div>

	<button
		class="text-btn"
		class:active={store.showVelocity}
		onclick={() => {
			store.showVelocity = !store.showVelocity;
		}}
	>
		Velocity
	</button>

	<button class="text-btn" onclick={handleClearAll}>Clear All</button>

	<div class="spacer"></div>

	<button
		class="text-btn expand-btn"
		onclick={() => document.documentElement.requestFullscreen?.()}
		aria-label="Expand to fullscreen"
	>
		<svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
			<path
				d="M1 4V1h3M9 1h3v3M12 9v3H9M4 12H1V9"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
		Expand
	</button>
</div>

<style>
	.toolbar {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 0 14px;
		height: 48px;
		background: #13131f;
		border-bottom: 1px solid #252540;
		flex-shrink: 0;
	}

	/* ── Transport ── */
	.transport {
		display: flex;
		gap: 4px;
		align-items: center;
	}

	.icon-btn {
		width: 30px;
		height: 30px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		border-radius: 6px;
		background: #232338;
		color: #9090c0;
		cursor: pointer;
		transition:
			background 0.12s,
			color 0.12s;
	}

	.icon-btn:hover {
		background: #303050;
		color: #d0d0f0;
	}

	.play-btn {
		color: #55cc66;
	}
	.play-btn:hover {
		color: #66dd77;
		background: #1e2e22;
	}
	.play-btn.playing {
		color: #55cc66;
		background: #1e2e22;
	}

	.rec-btn {
		color: #dd4444;
	}
	.rec-btn:hover {
		color: #ff5555;
	}
	.rec-btn.recording {
		animation: rec-pulse 1s ease-in-out infinite;
	}

	.loop-btn {
		color: #8888c0;
	}
	.loop-btn:hover {
		color: #aaaaee;
	}
	.loop-btn.active {
		color: #6b6bd9;
		background: #1e1e38;
	}

	@keyframes rec-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.45;
		}
	}

	/* ── Time display ── */
	.time-display {
		font-family: 'Courier New', monospace;
		font-size: 14px;
		font-weight: 700;
		color: #c8c8e8;
		background: #0c0c18;
		border: 1px solid #2a2a45;
		border-radius: 4px;
		padding: 3px 10px;
		min-width: 88px;
		text-align: center;
		letter-spacing: 0.04em;
	}

	/* ── Snap ── */
	.snap-group {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.snap-icon {
		color: #666688;
		flex-shrink: 0;
	}

	.snap-pill {
		width: 28px;
		height: 16px;
		background: #6b6bd9;
		border: none;
		border-radius: 8px;
		padding: 2px;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		cursor: pointer;
	}

	.snap-knob {
		width: 12px;
		height: 12px;
		background: #fff;
		border-radius: 50%;
	}

	.snap-label {
		font-size: 12px;
		color: #888aaa;
	}

	.snap-btn {
		padding: 3px 7px;
		border: none;
		border-radius: 4px;
		background: transparent;
		color: #666888;
		font-size: 12px;
		cursor: pointer;
		transition: all 0.12s;
	}

	.snap-btn:hover {
		background: #252545;
		color: #c0c0e0;
	}
	.snap-btn.active {
		background: #6b6bd9;
		color: #fff;
		font-weight: 600;
	}

	/* ── Text buttons ── */
	.text-btn {
		padding: 4px 10px;
		border: none;
		border-radius: 4px;
		background: transparent;
		color: #666888;
		font-size: 12px;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 5px;
		transition: all 0.12s;
	}

	.text-btn:hover {
		background: #252545;
		color: #c0c0e0;
	}
	.text-btn.active {
		color: #c0c0e0;
		background: #252545;
	}

	.expand-btn {
		gap: 5px;
	}

	.spacer {
		flex: 1;
	}

	/* ── Zoom ── */
	.zoom-group {
		display: flex;
		gap: 2px;
		align-items: center;
	}
</style>
