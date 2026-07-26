# Piano Roll Specification

## Overview

The Piano Roll is the central editing tool of Composer Studio. It provides a MIDI-style
visual interface for composing and editing note sequences, with an integrated synthesizer
for real-time audio playback via the Web Audio API.

## Architecture

Implemented as Svelte 5 components under `src/lib/piano-roll/`, mounted at the
SvelteKit home route in `src/routes/+page.svelte`.

### Component Tree

```text
PianoRoll.svelte          — Root layout, scroll container, playhead tracking
├── Toolbar.svelte         — Transport controls, snap grid, actions
├── PianoKeys.svelte       — Sticky-left piano keyboard column
├── NoteGrid.svelte        — Scrollable note-editing canvas
└── SynthPanel.svelte      — Synthesizer settings panel (right side)
```

### Supporting Modules

| File              | Purpose                                                |
| ----------------- | ------------------------------------------------------ |
| `types.ts`        | TypeScript interfaces shared across components         |
| `store.svelte.ts` | Svelte 5 rune-based singleton reactive store           |
| `audio.ts`        | Web Audio API playback engine with lookahead scheduler |
| `midi-export.ts`  | MIDI type-0 file serialisation                         |

---

## Data Model

### Note

```typescript
interface Note {
	id: string;
	midiNote: number; // MIDI pitch 36 (C2) – 107 (B7)
	startBeat: number; // Start time in quarter-note beats
	durationBeats: number; // Duration in quarter-note beats (min: one snap unit)
	velocity: number; // 1–127
}
```

### SynthSettings

```typescript
interface SynthSettings {
	waveform: OscillatorType; // 'sine' | 'square' | 'sawtooth' | 'triangle'
	volume: number; // 0–100
	envelope: {
		attack: number; // seconds (0.001–2)
		decay: number; // seconds (0.001–2)
		sustain: number; // 0–1
		release: number; // seconds (0.001–4)
	};
	filter: {
		enabled: boolean;
		cutoff: number; // Hz (20–20 000)
		resonance: number; // Q factor (0–20)
	};
}
```

### EditorState (store.svelte.ts)

```typescript
{
  notes: Note[];
  isPlaying: boolean;
  isRecording: boolean;
  currentBeat: number;
  snapDenominator: 1 | 2 | 4 | 8 | 16;  // denominator of note value
  showVelocity: boolean;
  loopEnabled: boolean;
  totalBeats: number;       // loop length in beats (default 64 = 16 bars)
  pixelsPerBeat: number;    // horizontal zoom (default 80)
  rowHeight: number;        // px per semitone row (default 24)
  tempo: number;            // BPM (default 120)
  synthSettings: SynthSettings;
  // Derived
  snapBeats: number;        // 4 / snapDenominator
}
```

---

## Features

### Toolbar

| Control        | Behaviour                                                            |
| -------------- | -------------------------------------------------------------------- |
| Play / Stop    | Toggles audio playback; animates the playhead                        |
| Stop (square)  | Halts playback and resets playhead to beat 0                         |
| Record         | Reserved for future Web MIDI API input recording                     |
| Loop indicator | Visual toggle; playback wraps at `totalBeats`                        |
| Time display   | `bar : beat : ticks` (e.g. `1:1:00`), monospace                      |
| Snap buttons   | `1 / 1/2 / 1/4 / 1/8 / 1/16` — quantises note placement and movement |
| Velocity       | Toggles the velocity lane below the note grid                        |
| Expand         | Requests browser fullscreen                                          |
| Clear All      | Removes all notes after confirmation                                 |
| Export MIDI    | Downloads a type-0 `.mid` file                                       |

### Piano Keys — left column, `position: sticky; left: 0`

- Displays the MIDI range **C2–B7** (72 rows) from top (highest) to bottom (lowest).
- **White-key rows** — natural notes (C D E F G A B), lighter background.
- **Black-key rows** — sharps/flats, darker background.
- **C-note rows** — faint top border marking octave boundaries.
- Clicking a key **auditions** the note through the synth engine (500 ms).
- During playback, keys corresponding to currently-sounding notes are highlighted.

### Note Grid — main scrollable canvas

**Axes**

| Axis       | Unit                     | Default scale |
| ---------- | ------------------------ | ------------- |
| Horizontal | quarter-note beats       | 80 px / beat  |
| Vertical   | semitone (MIDI note row) | 24 px / row   |

**Grid lines (CSS `background-image`)**

| Line type | Interval      | Colour    |
| --------- | ------------- | --------- |
| Bar line  | Every 4 beats | `#3a3a60` |
| Beat line | Every 1 beat  | `#262640` |

**Note interactions**

| Gesture                          | Result                                                        |
| -------------------------------- | ------------------------------------------------------------- |
| Click empty space                | Create note at snapped position; drag to set initial duration |
| Drag note body                   | Move note (pitch + time, snapped)                             |
| Drag note right edge (last 8 px) | Resize duration (snapped, ≥ 1 snap unit)                      |
| Right-click note                 | Delete note                                                   |

**Playhead** — 2 px vertical line tracking `currentBeat`; the scroll container
auto-scrolls to keep the playhead visible.

**Velocity lane** — shown when `showVelocity` is `true`; bar chart below the note
grid; drag bars to set per-note velocity (planned).

### Synth Panel — right column, fixed width 220 px

| Section    | Controls                                            |
| ---------- | --------------------------------------------------- |
| Preset     | Dropdown of named presets stored in component state |
| Waveform   | Dropdown: Sine / Square / Sawtooth / Triangle       |
| Volume     | Range slider 0–100 %                                |
| Tempo      | Range slider 40–240 BPM                             |
| Envelope ▾ | Attack / Decay / Sustain / Release sliders          |
| Filter ▾   | Enable toggle + Cutoff (Hz) + Resonance sliders     |
| Effects ▾  | Reserved (reverb / delay — future work)             |

---

## Audio Engine (`audio.ts`)

### AudioContext

One shared `AudioContext` created lazily on first interaction.

### Playback scheduler

- `setInterval` at **25 ms** intervals.
- On each tick, schedules all notes within the next **100 ms** lookahead window.
- Each note: `OscillatorNode → (optional BiquadFilterNode) → GainNode → destination`.
- Applies **ADSR envelope** via `GainNode.gain` `AudioParam` automation.
- Tracks scheduled notes by `noteId:loopIteration` key to prevent double-scheduling.
- A `requestAnimationFrame` loop updates `currentBeat` for smooth playhead animation.

### Loop handling

When `loopEnabled` is `true`, the scheduler calculates the loop iteration for each
note and schedules it accordingly; the playhead wraps at `totalBeats`.

### Frequency mapping

$$f = 440 \times 2^{(\text{midiNote} - 69) \,/\, 12}$$

### Audition (key click)

Triggers a 500 ms note at the clicked pitch, using current synth settings.

---

## MIDI Export (`midi-export.ts`)

Generates a **MIDI type-0** file entirely in-browser:

- **Resolution**: 480 ticks per quarter note.
- **Tempo event**: derived from current BPM.
- **Note On / Note Off** pairs sorted by absolute tick.
- **Channel**: 0.
- Delivered as a `Blob` download (`track.mid`).

---

## Layout

```text
┌─────────────────────────────────────────────────────────────────────┐
│  App header: title                                    [Export MIDI] │
├─────────────────────────────────────────────────────────────────────┤
│  ▶ ■ ● │ 1:1:00 │ ⊞ Snap 1 1/2 1/4 1/8 1/16 │ Velocity │ Expand  │
├────────────┬────────────────────────────────────────┬───────────────┤
│ (spacer)   │ [Ruler: measure numbers]               │               │
│────────────┼────────────────────────────────────────│  Synth Panel  │
│            │                                        │               │
│  Piano     │  Note Grid (scrollable H + V)          │  Waveform     │
│  Keys      │                                        │  Volume       │
│  (sticky   │  [notes as coloured blocks]            │  Tempo        │
│   left)    │                                        │  Envelope ▾   │
│            │  [Playhead vertical line]              │  Filter ▾     │
│            │                                        │  Effects ▾    │
└────────────┴────────────────────────────────────────┴───────────────┘
```

---

## Keyboard Shortcuts (planned)

| Key                    | Action                |
| ---------------------- | --------------------- |
| `Space`                | Play / Stop           |
| `Delete` / `Backspace` | Delete selected notes |
| `Ctrl+A`               | Select all notes      |
| `Ctrl+Z`               | Undo                  |
| `Ctrl+Y`               | Redo                  |
| `Ctrl+Shift+E`         | Export MIDI           |

---

## Future Work

- Web MIDI API recording from physical keyboard/controller
- Multi-track sequencing (multiple piano roll lanes)
- Undo/redo history
- Note selection and bulk operations (transpose, quantise, humanise)
- Velocity lane editing
- Reverb and delay effects nodes
- Chord voicing helper
- Scale/key highlighting on piano keys and grid rows
