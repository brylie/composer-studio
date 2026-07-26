# Tracks Specification: Scale, Chord, Arranger

## Overview

Cubase-style scale/chord/arranger/labels tracks, built on the generic
event-track abstraction from [timeline.md](./timeline.md). The scale track is
specified in full for the initial development pass; chord, arranger, and
labels tracks are deliberately scoped as placeholders — enough shape to not
block the scale track's design, not enough detail to pretend they're decided.

---

## Scale track (specified)

### Data model

```typescript
interface ScaleEvent {
  id: string;
  beat: number;
  root: number; // pitch class 0–11 (0 = C), matches NOTE_NAMES in types.ts
  mode: string; // tonal.js scale name ('major', 'dorian', 'harmonic minor', ...) — see libraries.md
}

type ScaleTrack = ScaleEvent[]; // an EventTrack<ScaleEvent> per timeline.md
```

Placing a scale event at a beat changes the active scale from that point
onward — resolved via `timeline.md`'s `activeEventAt(scaleTrack, beat)`, not
by copying "current scale" into other state.

### Context-aware highlighting

**This is the part that's easy to get wrong**: highlighting is not "compute
the set of in-scale MIDI notes once, highlight those piano-key rows." Because
more than one `ScaleEvent` can be visible in the note grid's current scroll
viewport at once, the highlight must be computed **per horizontal segment**
between consecutive scale events, not globally:

```typescript
// for the currently visible beat range [viewStart, viewEnd):
const carryIn = activeEventAt(scaleTrack, viewStart); // per timeline.md — the scale
// already active when the viewport starts, even if it was placed well before viewStart
const withinView = scaleEventsOverlapping(scaleTrack, viewStart, viewEnd).filter(
  (event) => event.id !== carryIn?.id,
); // avoid double-counting if it's also the first in-view event

const events = carryIn ? [carryIn, ...withinView] : withinView;

const segments = events.map((event, i, all) => ({
  startBeat: Math.max(event.beat, viewStart), // clamp — carryIn's own beat may be long before viewStart
  endBeat: Math.min(all[i + 1]?.beat ?? viewEnd, viewEnd),
  scaleDegrees: pitchClassesFor(event.root, event.mode), // Set<number>, 0–11
}));
```

Without the carried-in event, a viewport scrolled to a range containing no
`ScaleEvent` at all (common — most scrolling doesn't land exactly on a scale
change) would compute zero segments and silently drop the highlight for a
scale that's still very much active, just placed earlier. Every segment's
bounds are clamped to `[viewStart, viewEnd)` regardless of where the
underlying event actually sits on the timeline — the highlight band should
never extend into invisible territory the segment computation didn't ask
about.

The note grid renders each segment as its own highlighted-row band (e.g. a
subtle background tint or outline on in-scale rows, per the outline idea) —
rows that are in-scale in one segment and out-of-scale in the adjacent one
must visibly change at the segment boundary, not blend.

### Non-diatonic input stays legal

The highlight is advisory only. Users can place any MIDI note regardless of
the active scale — there's no quantization or hard constraint. This matters
for the data model: `Note` never references a scale; scale membership is
computed for display, not stored or enforced.

### Piano Keys column

The sticky piano-keys column ([piano-roll.md](./piano-roll.md#piano-keys--left-column-position-sticky-left-0))
highlights scale-degree rows using the scale active **at the current playhead
position** (a single segment, since the keys column isn't tied to a scrollable
beat range the way the grid body is).

---

## Chord track (placeholder)

Scale-aware but explicitly **not** constrained to diatonic chords — a chord
event can be flagged as "outside the active scale" for display purposes
without being disallowed.

### `ChordEvent` carries a pitch-class set, not just a label

The `quality` string alone (`'maj7'`, `'sus4'`, ...) isn't enough to drive the
three things a chord event actually needs to do — highlight chord tones on
the piano roll, check tension against the active scale, and feed
`generate-chords`'s voicing math — all three need the _actual pitch classes_,
not a name to re-parse each time. `quality` (looked up against an
interval-set table) is the authoring convenience; `pitchClasses` is the
derived form everything else consumes:

```typescript
interface ChordEvent {
  id: string;
  beat: number;
  root: number; // pitch class 0–11
  quality: string; // tonal.js chord symbol ('maj7', 'sus4', 'm7b5', ...) — see libraries.md
}

type ChordTrack = ChordEvent[];

function pitchClassesForChord(chord: ChordEvent): Set<number> {
  // backed by tonal.js's Chord.get(...), per libraries.md — not a
  // hand-rolled interval table
}
```

This deliberately mirrors `ScaleEvent`'s `pitchClassesFor(root, mode)` — a
chord is "just" a smaller pitch-class set active over the same kind of
beat-segment as a scale, which is why all three use cases below reuse the
scale track's segment-computation approach rather than inventing a new one.

### Three consumers of `pitchClasses`

1. **Chord-tone highlighting** — layered on top of
   [scale-degree highlighting](#context-aware-highlighting): within a beat
   segment, rows matching the active chord's pitch classes get a stronger
   highlight than rows that are merely in-scale, and rows outside both get
   none. Same per-segment computation as the scale track, just intersecting
   two pitch-class sets (chord segments and scale segments) instead of one —
   segment boundaries come from _both_ tracks' events, so a chord change
   mid-scale-segment still produces a visible boundary.
2. **Tension against the active scale** — replaces the earlier binary
   `isDiatonic` with the actual offending pitch classes, since "which notes
   clash" is more useful than "does it clash":
   ```typescript
   function tensionPitchClasses(chord: ChordEvent, scale: ScaleEvent | undefined): Set<number> {
     // pitchClassesForChord(chord) minus the scale's pitch classes — empty ⇒ fully diatonic
   }
   ```
   An empty result _is_ what "diatonic" meant before; a non-empty result can
   drive a distinct visual treatment (e.g. an outline color for the specific
   chord tones that fall outside the scale) instead of a single flag.
3. **`generate-chords` voicing input** — `source: 'chord-track'` in
   [transformations.md](./transformations.md#generate-chords-is-the-priority-v1-case)
   voices `pitchClassesForChord(event)` within the requested octave range;
   the voicing algorithm never needs to know `quality` was `'dom7'` vs. some
   other label, only the resulting pitch classes.

**A `ChordEvent` is still a harmony label, not sounding notes** — it does not
itself produce audible notes. The actual chord _notes_ that get voiced into
the piece are plain entries in the same `Note[]` collection the melody lives
in, written by the `generate-chords` command. This separation is what lets a
chord label be edited (change the harmony) without having to re-place
already-voiced notes, and lets `generate-chords` be re-run with different
voicing/octave choices without touching the label track.

Full chord-track UX (lane rendering, editing interaction, the `quality`
vocabulary and its interval table) is out of scope until this milestone is
scheduled — but note it isn't actually a hard prerequisite for
`generate-chords`, since `source: 'selection-derived'` works without it.

---

## Labels track (placeholder)

Distinct from both event tracks (scale/chord, which carry structured
harmonic payloads) and the arranger track (spans with duration): a labels
track holds **freeform point annotations** — sticky-note-style markers like
"solo starts here" or "verse 2 lyric cue" that don't affect playback or any
transformation's behavior.

```typescript
interface LabelEvent {
  id: string;
  beat: number;
  text: string;
}

type LabelTrack = LabelEvent[];
```

No further design beyond this shape — rendering and editing interaction are
out of scope until scheduled.

---

## Arranger track (placeholder)

See [timeline.md](./timeline.md#sections-arranger-vs-events) for the
`ArrangerSection` shape and the ripple-vs-free-placement question.

### v1 default: annotation-only, no content ripple

Resolving that open question with a concrete starting point rather than
leaving it fully undecided: a section is a labeled, colored region on the
arranger lane — add by tapping empty space, move by dragging the block,
resize by dragging an edge, rename/delete via tap. **It does not carry notes
or other tracks' content when moved or duplicated in v1** — it's a visual map
of the piece, not a structural editing tool yet. This is a deliberate
simplification, not the final answer: content-carrying move/duplicate (the
behavior actually wanted, per this document's motivating use case) is real
future work, at which point the ripple-vs-free-placement question in
`timeline.md` has to be resolved for real. Shipping the simpler
annotation-only version first means the arranger lane is useful (for seeing
song structure at a glance) well before that harder problem needs solving.

---

## Shared lane component

All track types (plus tempo/time-signature from `timeline.md`) render as thin
horizontal lanes that must:

- Share horizontal scroll position and `pixelsPerBeat` zoom with the note grid
  (synced scroll — this is the entire point of a shared timeline)
- Render markers at each event's beat, with click-to-edit (inline or via a
  popover, TBD per track type)
- Stack in a fixed vertical order: arranger (topmost, spans the full timeline
  width), then tempo/time-signature, then scale, then chord, then labels, then
  the note grid itself — matching the Cubase convention this spec is modeled
  on, with labels placed just above the grid since they're the most
  note-adjacent annotation

```text
┌─────────────────────────────────────────────────────────────┐
│ Arranger    [ Verse ][ Chorus  ][ Verse ][ Bridge ]          │
├─────────────────────────────────────────────────────────────┤
│ Tempo / Sig  ♩=120                    ♩=140  3/4             │
├─────────────────────────────────────────────────────────────┤
│ Scale        C major          A minor         C major        │
├─────────────────────────────────────────────────────────────┤
│ Chord        Cmaj7   Am7   Dm7   G7                          │
├─────────────────────────────────────────────────────────────┤
│ Labels                    ♪ solo starts here                 │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Note Grid (unchanged from piano-roll.md)                    │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

Implementation detail: a single `EventTrackLane` component parameterized by
track type, rather than one bespoke component per lane — same motivation as
the ribbon's shared `CommandParamsForm`.

---

## Future Work

- Finalize the `mode` vocabulary for `ScaleEvent` (named modes vs. arbitrary
  interval sets vs. both)
- Chord quality vocabulary (the `INTERVALS` table `pitchClassesForChord`
  reads from) and chord-lane editing UX
- Resolve arranger ripple semantics (see timeline.md), then upgrade the v1
  annotation-only arranger to content-carrying move/duplicate
- Labels track lane rendering and inline-edit interaction
