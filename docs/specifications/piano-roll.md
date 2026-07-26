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
  loopStart: number;        // beat, default 0 — planned, not yet in store.svelte.ts, see Ruler below
  loopEnd: number;          // beat, default = totalBeats — planned, not yet in store.svelte.ts
  totalBeats: number;       // project/timeline length in beats (default 64 = 16 bars)
  pixelsPerBeat: number;    // horizontal zoom (default 80)
  rowHeight: number;        // px per semitone row (default 24)
  tempo: number;            // BPM (default 122)
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

### Ruler

- Displays bar numbers along the top of the note grid, synced to the same
  horizontal scroll/zoom as the grid body (and, per
  [timeline.md](./timeline.md#synced-scroll), every other track lane).
- **Click/drag on the ruler** scrubs the playhead to that beat (snapped).
- **Loop markers** (planned, not yet implemented) — draggable start/end
  handles on the ruler, grid-snapped, with the region between them rendered
  as a highlighted band. This requires `loopStart`/`loopEnd` beat fields on
  `EditorState` in addition to the existing `totalBeats`/`loopEnabled` (see
  Data Model below) **and** new `getLoopStart`/`getLoopEnd` getters on
  `audio.ts`'s `PlaybackOptions` — today that interface only exposes
  `getTotalBeats`/`getLoopEnabled`, so the scheduler has no way to read a
  loop region even once the store fields exist; both pieces land together
  (see [audio-engine.md](./audio-engine.md#loop-handling)). Today's
  implementation loops the full `totalBeats` span with no adjustable in/out
  points.
- **Rewind** (planned transport control, not in today's Toolbar at all —
  only "Stop (square)" resets to beat 0, per Toolbar below) would return
  the playhead to `loopStart` if `loopEnabled`, otherwise to beat 0 —
  distinct from Stop, which halts playback in addition to resetting
  position. Not buildable before `loopStart` exists.

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

**Note interactions — desktop (mouse), `'draw'` grid mode**

| Gesture                          | Result                                                        |
| -------------------------------- | ------------------------------------------------------------- |
| Click empty space                | Create note at snapped position; drag to set initial duration |
| Drag note body                   | Move note (pitch + time, snapped)                             |
| Drag note right edge (last 8 px) | Resize duration (snapped, ≥ 1 snap unit)                      |
| Right-click note                 | Delete note                                                   |
| Double-click note                 | Opens the [note inspector](./editing-model.md#note-inspector-precise-numeric-entry) for exact pitch/start/duration/velocity entry |

**Note interactions — touch, `'draw'` grid mode**

Right-click has no touch equivalent, so touch needs its own affordances rather
than silently losing delete/inspect functionality:

| Gesture                    | Result                                                                 |
| --------------------------- | ------------------------------------------------------------------------ |
| Tap empty cell              | Create note at snapped position (default length, no drag-to-size)        |
| Tap existing note           | Delete note                                                              |
| Drag note body              | Move note (pitch + time, snapped)                                       |
| Drag note right edge        | Resize duration                                                          |
| Long-press note             | Opens the [note inspector](./editing-model.md#note-inspector-precise-numeric-entry) bottom sheet: pitch/start/duration/velocity fields, plus duplicate and delete |
| Pinch (two-finger)          | Zoom the grid (adjusts `pixelsPerBeat`/`rowHeight` together)             |
| One-finger drag, empty space | Pans the grid (does **not** create a note — see mode note below)       |

Tap-to-delete and long-press-to-inspect are both gestures on an existing
note, disambiguated by hold duration rather than by anything about the
gesture's shape: crossing the long-press threshold (while the touch point
hasn't moved past the drag threshold) fires the inspector and **cancels**
the pending tap, so releasing afterward does not also delete the note.
Released before the threshold, it's an ordinary tap and deletes as usual.
Without this, a long-press would fire both handlers — opening the inspector
on an already-deleted note.

Tap-to-delete and one-finger-pan-to-scroll both claim "drag/tap on empty
space," which only works because `'draw'` mode treats a stationary tap as
create/delete and a moving drag as pan — the same disambiguation
[selection.md](./selection.md#mode-based-interaction-semantics) uses between
`'draw'` and `'select'` grid modes for lasso vs. note-creation. See that
document for the full mode/gesture matrix, including `'select'` mode's lasso
and toggle-select behavior.

**Playhead** — 2 px vertical line tracking `currentBeat`; the scroll container
auto-scrolls to keep the playhead visible.

**Velocity lane** — shown when `showVelocity` is `true`; bar chart below the note
grid; drag bars to set per-note velocity (planned).

### Synth Panel — responsive "Sound drawer"

| Section    | Controls                                            |
| ---------- | --------------------------------------------------- |
| Preset     | Dropdown of named presets stored in component state |
| Instrument | Dropdown: **Piano** (`Tone.PolySynth` preset, default) / Sine / Square / Sawtooth / Triangle — see [libraries.md](./libraries.md#mvp-default-instrument-tonepolysynth-over-tonesynth) |
| Volume     | Range slider 0–100 %                                |
| Tempo      | Range slider 40–240 BPM                             |
| Envelope ▾ | Attack / Decay / Sustain / Release sliders          |

**Ownership**: `selectedPreset` (the highlighted dropdown entry) is
component-local `$state`, not part of `store.synthSettings` — it exists only
to highlight which named bundle was last loaded, not to persist a "current
preset" concept. `store.synthSettings` (`waveform`, `volume`, `envelope`,
`filter`) is the actual document/session state every control ultimately
reads from and writes to; loading a preset does `store.synthSettings =
structuredClone(presetSettings)`, a full overwrite, same as any other
mutation of that object. Nothing currently resets `selectedPreset` back to
"none" when a slider is subsequently dragged, so the dropdown can show a
preset name that no longer matches the live settings — pre-existing, worth
fixing alongside whichever of these two changes lands first.

**Preset "Piano" vs. Instrument "Piano" — a naming collision to resolve
before the Instrument selector ships**: the existing preset list already
has an entry named `'Piano'` (`waveform: 'triangle'`, plus its own
envelope/filter values) — a plain oscillator bundle with no relation to
Tone.js. Once the Instrument dropdown's own `Tone.PolySynth`-based "Piano"
option exists, the two "Piano" labels would refer to genuinely different
things (an oscillator preset vs. a different synth engine entirely), which
is confusing regardless of how either is implemented. Resolution: **Preset
stops setting `waveform`.** Once Instrument exists as the top-level choice
of synth engine, Preset narrows to only setting `volume`/`envelope`/`filter`
— a named character (warm, bright, plucky) layered on top of whichever
Instrument is active — and the existing `'Piano'` preset is renamed to
something that describes its envelope/filter character rather than an
instrument name it no longer owns (e.g. `'Warm'`), so only the Instrument
dropdown's entry is ever called "Piano."
| Filter ▾   | Enable toggle + Cutoff (Hz) + Resonance sliders     |
| Effects ▾  | Reserved (reverb / delay — see [libraries.md](./libraries.md#tonejs--adopt-but-its-a-rewrite-not-just-an-addition)) |

The Sound drawer is a consumer of [overlay-shells.md](./overlay-shells.md#shell-contract)'s
shared shell, same as the ribbon's parameter drawer and the note inspector —
it does not define its own responsive breakpoint or dimensions. Opened via
the dedicated Sound-drawer button in the [top bar](./ribbon.md#top-bar) at
every breakpoint: a mobile-width bottom sheet, or a right-aligned side
drawer on tablet/desktop, per the shell's `isMobile` check.

### Default viewport zoom

The underlying pitch range stays C2–B7 (72 rows) regardless of device — only
the *default visible window* differs: desktop opens showing more of the
range at once, while mobile defaults to roughly 2 octaves visible (scrolling
for the rest), matching its narrower vertical viewport. This is a default
`rowHeight`/scroll-position choice, not a change to the data range.

---

## Audio and export

Audio synthesis (`audio.ts`) and MIDI export (`midi-export.ts`) are decomposed
into their own document — [audio-engine.md](./audio-engine.md) — since
[libraries.md](./libraries.md)'s Tone.js migration rewrites the former
entirely, and [persistence.md](./persistence.md) needed its own place to
describe project-file export/import without piling more onto this file.

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

Several items originally listed here now have their own full specs rather
than being open future work — listed for traceability, not as remaining gaps:
undo/redo → [command-history.md](./command-history.md); selection and bulk
transform operations → [selection.md](./selection.md) and
[transformations.md](./transformations.md); reverb/delay and a real piano
sound → [libraries.md](./libraries.md); scale-aware highlighting →
[tracks.md](./tracks.md); multi-instrument orchestration →
[layers.md](./layers.md) (one shared piano roll with instruments as
reorderable layers, not multiple lanes — resolves what "multi-track
sequencing" actually means for this app). What's left, still genuinely open:

- Web MIDI API recording from a physical keyboard/controller
- Velocity lane editing beyond single-note drag (batch/ramp editing) — see
  [editing-model.md](./editing-model.md#future-work)
