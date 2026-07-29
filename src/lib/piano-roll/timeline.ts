// Domain layer — generic event-track abstraction (timeline.md).
//
// A TimelineEvent changes a context value from its beat onward, until
// superseded by the next event of the same type on the same track — the
// same model MIDI meta-events (tempo, time signature) use, and what makes
// scale/chord/arranger tracks a family rather than unrelated features.
// Concrete event types (TempoEvent, TimeSignatureEvent, ScaleEvent, ...)
// below declare their own fields flat alongside id/beat rather than wrapping
// a separate payload type — `ScaleEvent` genuinely satisfies
// `EventTrack<ScaleEvent>` as written, not just in description.

export interface TimelineEvent {
  id: string;
  beat: number;
}

/** Kept sorted by beat — activeEventAt/eventSegments below assume this. */
export type EventTrack<T extends TimelineEvent> = T[];

/**
 * The event active at `beat`: the last event with `event.beat <= beat`.
 * Binary search over the sorted track — every consumer (highlighting, ruler
 * rendering, export) asks "what's active here?" rather than maintaining its
 * own copy of the current value.
 */
export function activeEventAt<T extends TimelineEvent>(
  track: EventTrack<T>,
  beat: number,
): T | undefined {
  let lo = 0;
  let hi = track.length - 1;
  let result: T | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (track[mid].beat <= beat) {
      result = track[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

/**
 * Places `event` on the track. Beats are unique per track (timeline.md) —
 * an event already at `event.beat` is replaced, not stacked, the same way
 * dragging a marker to an occupied position just moves it. Returns a new
 * sorted array; does not mutate `track`.
 */
export function upsertEvent<T extends TimelineEvent>(
  track: EventTrack<T>,
  event: T,
): EventTrack<T> {
  const withoutCollision = track.filter((e) => e.beat !== event.beat);
  return [...withoutCollision, event].sort((a, b) => a.beat - b.beat);
}

/** Removes the event with `id`, if present. Returns a new array. */
export function removeEvent<T extends TimelineEvent>(
  track: EventTrack<T>,
  id: string,
): EventTrack<T> {
  return track.filter((e) => e.id !== id);
}

export interface TimelineSegment<T> {
  startBeat: number;
  endBeat: number;
  event: T;
}

/**
 * Slices `track` into segments covering [rangeStart, rangeEnd), one per
 * active event across that range (tracks.md#context-aware-highlighting).
 * Carries in whatever event was already active at rangeStart — even if it
 * was placed well before the range — so a range containing no event at all
 * doesn't silently drop a highlight that's still active, just placed
 * earlier. Every segment's bounds are clamped to the requested range
 * regardless of where the underlying event actually sits on the timeline.
 *
 * Generic over the family (scale/chord/labels/...), not scale-specific —
 * tracks.md's scale-track algorithm is the first consumer; the chord track
 * (Phase 7) reuses this exact function rather than a bespoke copy.
 */
export function eventSegments<T extends TimelineEvent>(
  track: EventTrack<T>,
  rangeStart: number,
  rangeEnd: number,
): TimelineSegment<T>[] {
  if (rangeEnd <= rangeStart) return [];

  const carryIn = activeEventAt(track, rangeStart);
  const withinRange = track.filter(
    (event) => event.beat >= rangeStart && event.beat < rangeEnd && event.id !== carryIn?.id,
  );
  const events = carryIn ? [carryIn, ...withinRange] : withinRange;

  return events.map((event, i) => ({
    startBeat: Math.max(event.beat, rangeStart),
    endBeat: Math.min(events[i + 1]?.beat ?? rangeEnd, rangeEnd),
    event,
  }));
}

// ── Concrete track types (timeline.md#data-model-additions) ────────────────

export interface TempoEvent extends TimelineEvent {
  bpm: number;
}
export type TempoTrack = EventTrack<TempoEvent>;

export interface TimeSignatureEvent extends TimelineEvent {
  numerator: number;
  denominator: number;
  /**
   * Additive beat grouping, e.g. [3, 2, 2] for 7/8 grouped 3+2+2
   * (tracks.md#v2-arbitrary--additive-signatures). Optional and
   * display-only — beatsPerBar/barBeats never read it, only
   * beatGroupLines below does. Not set by the v1 preset picker.
   */
  groups?: number[];
}
export type TimeSignatureTrack = EventTrack<TimeSignatureEvent>;

export interface ScaleEvent extends TimelineEvent {
  root: number; // pitch class 0–11 (0 = C), matches NOTE_NAMES in types.ts
  mode: string; // tonal.js scale name ('major', 'dorian', 'harmonic minor', ...)
}
export type ScaleTrack = EventTrack<ScaleEvent>;

/**
 * Scale-aware but not scale-constrained (tracks.md#chord-track-placeholder):
 * `quality` is the authoring convenience (a tonal.js chord symbol), while
 * `pitchClassesForChordEvent` (music-theory/index.ts) derives the actual
 * pitch classes everything else — highlighting, tension-checking,
 * generate-chords's voicing math — consumes.
 */
export interface ChordEvent extends TimelineEvent {
  root: number; // pitch class 0–11
  quality: string; // tonal.js chord symbol ('maj7', 'sus4', 'm7b5', ...)
}
export type ChordTrack = EventTrack<ChordEvent>;

/**
 * Freeform point annotation (tracks.md#labels-track-placeholder) — doesn't
 * affect playback or any transformation's behavior.
 */
export interface LabelEvent extends TimelineEvent {
  text: string;
}
export type LabelTrack = EventTrack<LabelEvent>;

// ── Bar math (timeline.md#time-signature-is-currently-hardcoded) ───────────

/** Beats per bar for a time signature, in canonical quarter-note beats. */
export function beatsPerBar(sig: TimeSignatureEvent): number {
  return sig.numerator * (4 / sig.denominator);
}

/**
 * Beat position of every bar line from beat 0 up to `totalBeats`, honoring
 * mid-timeline time-signature changes — replaces NoteGrid's previous
 * hardcoded "every 4 beats" assumption. Falls back to an implicit 4/4 grid
 * when the track is empty (defensive; the store always seeds one event).
 */
export function barBeats(track: TimeSignatureTrack, totalBeats: number): number[] {
  const events: TimeSignatureEvent[] =
    track.length > 0 ? track : [{ id: '', beat: 0, numerator: 4, denominator: 4 }];
  const bars: number[] = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const sectionEnd = Math.min(events[i + 1]?.beat ?? totalBeats, totalBeats);
    const step = beatsPerBar(event);
    if (step <= 0) continue;
    const sectionStart = Math.max(event.beat, 0);
    const barCount = Math.ceil((sectionEnd - sectionStart) / step);
    for (let n = 0; n < barCount; n++) {
      const beat = sectionStart + n * step;
      if (beat >= sectionEnd) break;
      bars.push(beat);
    }
  }
  return bars;
}

/**
 * Beat positions of a single bar's internal beat-grouping ticks
 * (tracks.md#effect-on-the-piano-roll-grid) — a tier finer than bar lines,
 * marking where the bar's internal pulses fall. `groups` absent (the v1
 * default — the preset picker never sets it) falls back to one group per
 * numerator unit, reproducing today's implicit "beat within the bar"
 * markers; a future v2 additive-grouping UI supplies `groups` directly for
 * asymmetric groupings (6/8's 3+3, a v2 7/8's 3+2+2, ...) without this
 * function needing a second code path. No line is produced at the bar's own
 * end — barBeats already draws that boundary.
 */
export function beatGroupLines(sig: TimeSignatureEvent, barStart: number): number[] {
  const unit = 4 / sig.denominator;
  const groups = sig.groups ?? Array<number>(sig.numerator).fill(1);
  const lines: number[] = [];
  let beat = barStart;
  for (const groupSize of groups.slice(0, -1)) {
    beat += groupSize * unit;
    lines.push(beat);
  }
  return lines;
}
