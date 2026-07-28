// Domain layer — arranger sections (tracks.md#arranger-track-placeholder,
// timeline.md#sections-arranger-vs-events). v1 is annotation-only per
// tracks.md#v1-default-annotation-only-no-content-ripple: sections carry no
// notes/other-track content when added/moved/resized/duplicated — the
// ripple-vs-free-placement question in timeline.md is deliberately deferred
// until the content-carrying upgrade is scheduled.
//
// Unlike the point-event tracks in timeline.ts (scale/chord/labels), a
// section spans a range and must not overlap another section — each
// represents a distinct span of song structure, so timeline.md's point-event
// collision rule ("placing at an occupied beat replaces what's there")
// doesn't apply. Every mutation below instead clamps against the gaps left
// by neighboring sections.

export interface ArrangerSection {
  id: string;
  label: string;
  startBeat: number;
  endBeat: number; // exclusive
  color: string;
}

/** Kept sorted by startBeat — mirrors EventTrack's sorted-by-beat invariant. */
export type ArrangerTrack = ArrangerSection[];

export const MIN_SECTION_BEATS = 1;
export const DEFAULT_SECTION_BEATS = 4;

/** A small fixed palette, cycled by track length so consecutive sections default to visibly distinct colors. */
export const SECTION_COLORS = [
  '#6b6bd9',
  '#d9736b',
  '#6bd9a0',
  '#d9c26b',
  '#a06bd9',
  '#6bb8d9',
] as const;

function sortByStart(track: ArrangerTrack): ArrangerTrack {
  return [...track].sort((a, b) => a.startBeat - b.startBeat);
}

/** The section containing `beat` ([startBeat, endBeat)), if any. */
export function sectionAt(track: ArrangerTrack, beat: number): ArrangerSection | undefined {
  return track.find((s) => s.startBeat <= beat && beat < s.endBeat);
}

interface Gap {
  start: number;
  end: number;
}

/**
 * The open spans between sections (and out to totalBeats), excluding
 * `excludeId` — the placement space available when adding a section or
 * moving one without its own current span blocking its own move.
 */
function findGaps(track: ArrangerTrack, excludeId: string | null, totalBeats: number): Gap[] {
  const sorted = sortByStart(track.filter((s) => s.id !== excludeId));
  const gaps: Gap[] = [];
  let cursor = 0;
  for (const section of sorted) {
    if (section.startBeat > cursor) gaps.push({ start: cursor, end: section.startBeat });
    cursor = Math.max(cursor, section.endBeat);
  }
  if (cursor < totalBeats) gaps.push({ start: cursor, end: totalBeats });
  return gaps;
}

/** The gap (if any) with room for `length`, whose placement is closest to `desiredStart`. */
function nearestGapFor(gaps: Gap[], desiredStart: number, length: number): Gap | null {
  let best: Gap | null = null;
  let bestDist = Infinity;
  for (const gap of gaps) {
    if (gap.end - gap.start < length) continue;
    const dist =
      desiredStart < gap.start
        ? gap.start - desiredStart
        : desiredStart > gap.end - length
          ? desiredStart - (gap.end - length)
          : 0;
    if (dist < bestDist) {
      bestDist = dist;
      best = gap;
    }
  }
  return best;
}

/**
 * Adds a new section at `beat` (tracks.md: "add by tapping empty space").
 * Sized DEFAULT_SECTION_BEATS, shrunk to fit the gap under `beat` when that
 * gap is narrower, clamped within the gap so it can't overlap a neighbor.
 * Returns `track` unchanged if `beat` already falls inside an existing
 * section (a tap there is a select, not an add — the lane component
 * resolves that disambiguation before calling this) or no gap at `beat` has
 * room for even MIN_SECTION_BEATS.
 */
export function addSectionAt(
  track: ArrangerTrack,
  beat: number,
  totalBeats: number,
  label = 'New section',
): ArrangerTrack {
  if (sectionAt(track, beat)) return track;
  const gaps = findGaps(track, null, totalBeats);
  const gap = gaps.find((g) => g.start <= beat && beat < g.end);
  if (!gap) return track;
  const length = Math.min(DEFAULT_SECTION_BEATS, gap.end - gap.start);
  if (length < MIN_SECTION_BEATS) return track;
  const startBeat = Math.max(gap.start, Math.min(beat, gap.end - length));
  const color = SECTION_COLORS[track.length % SECTION_COLORS.length];
  const section: ArrangerSection = {
    id: crypto.randomUUID(),
    label,
    startBeat,
    endBeat: startBeat + length,
    color,
  };
  return sortByStart([...track, section]);
}

/**
 * Moves section `id` so its startBeat is as close to `desiredStart` as
 * possible without overlapping another section or leaving [0, totalBeats)
 * (tracks.md: "move by dragging the block") — its duration is preserved.
 * Returns `track` unchanged if the result is identical to the current
 * position, or if no gap anywhere can fit its duration.
 */
export function moveSection(
  track: ArrangerTrack,
  id: string,
  desiredStart: number,
  totalBeats: number,
): ArrangerTrack {
  const section = track.find((s) => s.id === id);
  if (!section) return track;
  const length = section.endBeat - section.startBeat;
  const clampedDesiredStart = Math.max(0, desiredStart);
  const gap = nearestGapFor(findGaps(track, id, totalBeats), clampedDesiredStart, length);
  if (!gap) return track;
  const startBeat = Math.max(gap.start, Math.min(clampedDesiredStart, gap.end - length));
  if (startBeat === section.startBeat) return track;
  return sortByStart(
    track.map((s) => (s.id === id ? { ...s, startBeat, endBeat: startBeat + length } : s)),
  );
}

/** The endBeat of the nearest section to the left of `id`'s current span, or 0. */
function leftEdge(track: ArrangerTrack, id: string): number {
  const self = track.find((s) => s.id === id);
  if (!self) return 0;
  let best = 0;
  for (const s of track) {
    if (s.id === id) continue;
    if (s.endBeat <= self.startBeat) best = Math.max(best, s.endBeat);
  }
  return best;
}

/** The startBeat of the nearest section to the right of `id`'s current span, or totalBeats. */
function rightEdge(track: ArrangerTrack, id: string, totalBeats: number): number {
  const self = track.find((s) => s.id === id);
  if (!self) return totalBeats;
  let best = totalBeats;
  for (const s of track) {
    if (s.id === id) continue;
    if (s.startBeat >= self.endBeat) best = Math.min(best, s.startBeat);
  }
  return best;
}

/**
 * Drags section `id`'s left edge to `desiredStart` (tracks.md: "resize by
 * dragging an edge"). Clamped to [the left neighbor's end (or 0),
 * endBeat - MIN_SECTION_BEATS] so it can neither overlap that neighbor nor
 * invert past its own right edge.
 */
export function resizeSectionStart(
  track: ArrangerTrack,
  id: string,
  desiredStart: number,
): ArrangerTrack {
  const section = track.find((s) => s.id === id);
  if (!section) return track;
  const lowerBound = leftEdge(track, id);
  const upperBound = section.endBeat - MIN_SECTION_BEATS;
  const startBeat = Math.max(lowerBound, Math.min(desiredStart, upperBound));
  if (startBeat === section.startBeat) return track;
  return track.map((s) => (s.id === id ? { ...s, startBeat } : s));
}

/** Mirrors resizeSectionStart for the right edge. */
export function resizeSectionEnd(
  track: ArrangerTrack,
  id: string,
  desiredEnd: number,
  totalBeats: number,
): ArrangerTrack {
  const section = track.find((s) => s.id === id);
  if (!section) return track;
  const upperBound = rightEdge(track, id, totalBeats);
  const lowerBound = section.startBeat + MIN_SECTION_BEATS;
  const endBeat = Math.max(lowerBound, Math.min(desiredEnd, upperBound));
  if (endBeat === section.endBeat) return track;
  return track.map((s) => (s.id === id ? { ...s, endBeat } : s));
}

/** Renames/recolors a section, leaving its span untouched (tracks.md: "rename ... via tap"). */
export function updateSection(
  track: ArrangerTrack,
  id: string,
  updates: { label: string; color: string },
): ArrangerTrack {
  const section = track.find((s) => s.id === id);
  if (!section) return track;
  if (section.label === updates.label && section.color === updates.color) return track;
  return track.map((s) => (s.id === id ? { ...s, ...updates } : s));
}

/** Removes section `id`, if present (tracks.md: "...delete via tap"). */
export function removeSection(track: ArrangerTrack, id: string): ArrangerTrack {
  if (!track.some((s) => s.id === id)) return track;
  return track.filter((s) => s.id !== id);
}
