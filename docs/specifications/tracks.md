# Tracks Specification: Time Signature, Scale, Chord, Arranger

## Overview

Cubase-style time-signature/scale/chord/arranger/labels tracks, built on the
generic event-track abstraction from [timeline.md](./timeline.md). The time
signature and scale tracks are specified in full for the initial development
pass; chord, arranger, and labels tracks are deliberately scoped as
placeholders — enough shape to not block the specified tracks' design, not
enough detail to pretend they're decided.

---

## Time signature track (specified)

### Data model

Builds on `TimeSignatureEvent` from
[timeline.md](./timeline.md#data-model-additions):

```typescript
interface TimeSignatureEvent {
  id: string;
  beat: number;
  numerator: number; // beats per bar, counted in the signature's own denominator unit
  denominator: number; // 1 | 2 | 4 | 8 | 16 | 32 — must be a power of two, see below
}

type TimeSignatureTrack = TimeSignatureEvent[]; // an EventTrack<TimeSignatureEvent> per timeline.md
```

`beatsPerBar(sig) = numerator * (4 / denominator)` converts to the canonical
quarter-note beat unit ([timeline.md](./timeline.md#coordinate-system)).
Placing an event changes the active time signature from that beat onward,
resolved via `activeEventAt(timeSignatureTrack, beat)` like every other event
track — no special-casing versus scale/chord/labels.

### Vocabulary sourced from tonal.js, not hand-rolled

Composer Studio is standardizing on tonal.js as its music-theory framework
([libraries.md](./libraries.md#tonaljs--adopt-now)) precisely because it
already covers pitch, chords, scales, keys, and — relevant here — rhythm and
meter, so this track shouldn't reinvent a parallel vocabulary. tonal's
[`TimeSignature`](https://tonaljs.github.io/tonal/docs/time/signatures)
module parses and validates signature strings (`"4/4"`, `"6/8"`, additive
`"3+2+3/8"`), classifies them (`simple`/`compound`/`regular`/`irregular`/
`irrational`), and ships `TimeSignature.names()` — a ready-made list of
commonly-used signatures. The `music-theory` adapter module
([libraries.md](./libraries.md#recommendation-wrap-it-dont-spray-it)) gains
two functions:

```typescript
function commonTimeSignatures(): { numerator: number; denominator: number; label: string }[] {
  // backed by TimeSignature.names(), filtered to the v1 preset list below
}

function parseTimeSignature(
  input: string,
): { numerator: number; denominator: number; groups?: number[] } | null {
  // backed by TimeSignature.get(input) — null for anything TimeSignature itself
  // rejects (denominator not a power of two, malformed string, ...)
}
```

This is additive, not a data-model change: `TimeSignatureEvent` keeps its own
flat `numerator`/`denominator` fields, matching the convention every other
concrete event follows
([timeline.md](./timeline.md#data-model-additions)) — tonal is used at the
_editing UI_ boundary (parsing what the user picks or types) and for the v1
preset list, not as the stored representation. This mirrors `ChordEvent`:
tonal supplies the vocabulary and parsing, the event itself stores plain
fields.

### v1: preset picker, not free-form entry

A fixed set of buttons, not two open numeric inputs — sourced from
`commonTimeSignatures()`, filtered and ordered to: **4/4, 3/4, 2/4, 2/2, 6/8,
9/8, 12/8, 5/4, 7/8**. That covers the simple duple/triple/quadruple meters,
cut time, the common compound meters (6/8, 9/8, 12/8), and the two "odd"
meters common enough in practice to name explicitly (5/4, 7/8) — without
opening the door to signatures tonal's own classifier would flag as
`irrational` or otherwise unusual. Every v1 preset is a plain `simple` or
`compound` signature `TimeSignature.get()` parses cleanly, so v1 needs no
input-validation UI at all.

### v2: arbitrary + additive signatures

Free-form entry: numerator as any positive integer, denominator constrained
to the standard power-of-two set (1, 2, 4, 8, 16, 32) via a `<select>` rather
than a free number field — real time signatures never use a non-power-of-two
denominator in practice, and constraining the input this way means a value
`parseTimeSignature` would reject can never be constructed in the first
place. This also unlocks additive/irregular meters — 7/8 as 3+2+2 rather
than an undifferentiated 7, 5/4 as 3+2 — by accepting tonal's `"3+2+2/8"`
string form directly, parsed via the same `parseTimeSignature`, with the
resulting `groups` breakdown driving the beat-grouping subdivisions below
instead of a uniform grouping guessed from the numerator alone. This is v2,
not v1, because it's only useful once there's a UI for _choosing_ a grouping
(3+2+2 vs. 2+2+3 vs. 2+3+2 all sum to 7/8) — genuinely new interaction
design, not just a wider input range.

`TimeSignatureEvent` gains one optional field for this, not a rewrite:

```typescript
interface TimeSignatureEvent {
  id: string;
  beat: number;
  numerator: number;
  denominator: number;
  groups?: number[]; // v2 only — e.g. [3, 2, 2] for 7/8 grouped 3+2+2; sums to numerator
}
```

`groups` is optional and display-only — `beatsPerBar`/`barBeats` (bar-length
math, below) never read it, only the beat-grouping renderer does. A v1
project with no `groups` on any event round-trips through v2 unchanged:
`numerator`/`denominator` alone still fully describe the bar.

### Effect on the piano-roll grid

**Bar lines** already exist and need no change: `timeline.ts`'s
`beatsPerBar`/`barBeats` already walk the time-signature track and replace
the note grid's previous hardcoded "every 4 beats" assumption
([timeline.md](./timeline.md#time-signature-is-currently-hardcoded)) —
`NoteGrid.svelte`'s bar-line rendering already consumes `store.barBeats`.
What's new under this spec is one tier finer:

**Beat-grouping lines** mark where each bar's internal pulses fall — e.g. 4/4
gets 3 evenly-spaced internal quarter-beat ticks, 6/8 gets a single internal
tick at the bar's midpoint (the two dotted-quarter groups: eighth-notes
1‑2‑3 | 4‑5‑6), and a v2 7/8 grouped 3+2+2 gets ticks after the 3rd and 5th
eighth rather than evenly-spaced eighths. This is a real, currently-missing
distinction: today's grid can only show a bar line every _N_ beats and, via
snap, an _even_ subdivision within it — it cannot visually distinguish 6/8's
asymmetric 3+3 pulse from a plain run of 6 equal beats, which is exactly the
information a compound or additive meter needs to read correctly at a
glance.

```typescript
function beatGroupLines(sig: TimeSignatureEvent, barStart: number): number[] {
  const unit = 4 / sig.denominator; // one denominator-unit, in canonical beats
  const groups = sig.groups ?? Array(sig.numerator).fill(1); // v1 fallback: one group per unit
  const lines: number[] = [];
  let beat = barStart;
  for (const groupSize of groups.slice(0, -1)) {
    // no line at the bar's own end — barBeats already draws that boundary
    beat += groupSize * unit;
    lines.push(beat);
  }
  return lines;
}
```

v1's fallback (`groups` absent ⇒ one group per numerator unit) reproduces
today's implicit "beat within the bar" markers exactly — 4/4 shows 3 evenly
spaced internal ticks — while leaving the function ready for v2's asymmetric
groupings without a second code path later. Rendered as a third visual tier:
lighter than bar lines, but distinct from the (often much finer) snap grid —
`NoteGrid.svelte`'s existing `.bar-line` class gets a sibling
`.beat-group-line`, not a variant of the snap-grid rendering.

### Cross-cutting: interaction with snap/quantization

Time granularity touches every time-based system, so it's worth being
explicit about what does _not_ need to change here versus what does:

- **Snap math is already time-signature-agnostic, correctly, and should stay
  that way.** `snapBeats = 4 / snapDenominator`
  ([store.svelte.ts](../../src/lib/piano-roll/store.svelte.ts)) is defined
  relative to the canonical quarter-note beat, not the active signature's
  denominator — because beats stay canonical regardless of meter
  ([timeline.md](./timeline.md#coordinate-system)), "snap to an eighth note"
  means the same absolute duration (0.5 beats) whether the active signature
  is 4/4, 6/8, or 7/8. Coupling `snapBeats` to
  `TimeSignatureEvent.denominator` would be a bug, not an improvement: it
  would silently change what "1/8" means depending on where the playhead
  sits, which the continuous-beat model
  ([timeline.md](./timeline.md#continuous-beats-not-a-fixed-step-grid))
  specifically avoids for every other feature.
- **What genuinely is time-signature-dependent is the _visual grouping_ of
  the grid, not the snap resolution** — exactly what the beat-grouping lines
  above render. A user snapping to eighth notes in 6/8 still gets 0.5-beat
  increments; what changes is which of those increments reads as a strong
  pulse (the downbeat of each dotted-quarter group) versus a weak one.
  Keeping that grouping information out of `snapBeats` and in
  `beatGroupLines` instead is the resolution to this cross-cutting concern,
  not a gap still open.
- **Bar-relative operations** — anything meaning "snap to the start of a
  bar" or "the Nth beat of the current bar," including any future
  quantize-to-bar transform ([transformations.md](./transformations.md)) —
  must resolve via `activeEventAt(timeSignatureTrack, beat)` +
  `beatsPerBar`, never a hardcoded 4-beat assumption, the same rule
  `barBeats` already follows.
- **Polymetric/per-track quantization** (different lanes snapping to
  different divisions of the beat at once) remains explicitly out of scope,
  per
  [timeline.md](./timeline.md#resolution-unlimited-in-storage-a-ui-concern-at-the-snap-grid)'s
  existing future-work note — nothing here changes that; a variable time
  signature is an orthogonal concern from a variable per-lane snap
  denominator.

### Lane and editor

Reuses `EventTrackLane` and `createLaneEditor` exactly as the scale/chord/
label lanes do (see [Shared lane component](#shared-lane-component)): click
empty lane space to add at the snapped beat, click a marker to edit, drag to
move — subject to the same beats-are-unique-per-track replace-on-collision
rule as every other event track
([timeline.md](./timeline.md#resolving-the-active-value-at-beat-x)). The
marker editor (an `OverlayShell` popover, matching the scale/chord/label
markers) shows the v1 preset buttons; a "Custom…" entry reveals the v2
numerator/denominator/additive-groups inputs once that milestone is built.
Shares the tempo/time-signature lane row with the tempo track (specified
separately, not part of this document), per the stacking order already
defined in [Shared lane component](#shared-lane-component).

One default `TimeSignatureEvent` at beat 0 (4/4) always exists — the same
"a project with no further events behaves exactly as today" guarantee as the
tempo track ([timeline.md](./timeline.md#data-model-additions)); deleting
the beat-0 marker is not offered, mirroring how a document can't have zero
tempo.

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

- v2 time-signature UI: free-form numerator/denominator entry plus additive
  grouping (`groups`) input for irregular meters (7/8 as 3+2+2 vs. 2+2+3,
  ...) — see [Time signature track](#v2-arbitrary--additive-signatures)
- Finalize the `mode` vocabulary for `ScaleEvent` (named modes vs. arbitrary
  interval sets vs. both)
- Chord quality vocabulary (the `INTERVALS` table `pitchClassesForChord`
  reads from) and chord-lane editing UX
- Resolve arranger ripple semantics (see timeline.md), then upgrade the v1
  annotation-only arranger to content-carrying move/duplicate
- Labels track lane rendering and inline-edit interaction
