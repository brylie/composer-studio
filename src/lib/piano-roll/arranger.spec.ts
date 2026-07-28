import { describe, expect, it } from 'vitest';
import type { ArrangerTrack } from './arranger.js';
import {
  addSectionAt,
  moveSection,
  removeSection,
  resizeSectionEnd,
  resizeSectionStart,
  sectionAt,
  updateSection,
} from './arranger.js';

describe('sectionAt', () => {
  it('finds the section containing a beat within [startBeat, endBeat)', () => {
    const track: ArrangerTrack = [
      { id: 'a', label: 'Verse', startBeat: 0, endBeat: 8, color: '#fff' },
    ];
    expect(sectionAt(track, 0)?.id).toBe('a');
    expect(sectionAt(track, 7.9)?.id).toBe('a');
    expect(sectionAt(track, 8)).toBeUndefined(); // endBeat is exclusive
  });

  it('returns undefined for an empty track', () => {
    expect(sectionAt([], 4)).toBeUndefined();
  });
});

describe('addSectionAt', () => {
  it('adds a DEFAULT_SECTION_BEATS-long section at the tapped beat on an empty track', () => {
    const result = addSectionAt([], 4, 64);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ label: 'New section', startBeat: 4, endBeat: 8 });
    expect(result[0].id).toBeTruthy();
    expect(result[0].color).toBeTruthy();
  });

  it('accepts a custom label', () => {
    const result = addSectionAt([], 0, 64, 'Chorus');
    expect(result[0].label).toBe('Chorus');
  });

  it('returns the track unchanged when the tapped beat falls inside an existing section', () => {
    const track: ArrangerTrack = [
      { id: 'a', label: 'Verse', startBeat: 0, endBeat: 8, color: '#fff' },
    ];
    expect(addSectionAt(track, 4, 64)).toBe(track);
  });

  it('shrinks to fit a gap narrower than DEFAULT_SECTION_BEATS', () => {
    const track: ArrangerTrack = [
      { id: 'a', label: 'Verse', startBeat: 0, endBeat: 4, color: '#fff' },
      { id: 'b', label: 'Chorus', startBeat: 6, endBeat: 10, color: '#fff' },
    ];
    // Gap is [4, 6) — 2 beats wide, narrower than the 4-beat default.
    const result = addSectionAt(track, 5, 64);
    expect(result).toHaveLength(3);
    const added = result.find((s) => s.id !== 'a' && s.id !== 'b');
    expect(added).toBeDefined();
    expect((added?.endBeat ?? 0) - (added?.startBeat ?? 0)).toBe(2);
    expect(added?.startBeat).toBeGreaterThanOrEqual(4);
    expect(added?.endBeat).toBeLessThanOrEqual(6);
  });

  it('returns the track unchanged when no gap exists at the tapped beat beyond totalBeats', () => {
    expect(addSectionAt([], 64, 64)).toEqual([]);
  });

  it('cycles through the color palette by track length', () => {
    let track: ArrangerTrack = [];
    track = addSectionAt(track, 0, 64, 'A');
    track = addSectionAt(track, 8, 64, 'B');
    expect(track[0].color).not.toBe(track[1].color);
  });
});

describe('moveSection', () => {
  it('moves a section to the desired start, preserving its duration', () => {
    const track: ArrangerTrack = [
      { id: 'a', label: 'Verse', startBeat: 0, endBeat: 4, color: '#fff' },
    ];
    const result = moveSection(track, 'a', 10, 64);
    expect(result[0]).toMatchObject({ startBeat: 10, endBeat: 14 });
  });

  it('clamps to the left neighbor rather than overlapping it', () => {
    const track: ArrangerTrack = [
      { id: 'a', label: 'Verse', startBeat: 0, endBeat: 4, color: '#fff' },
      { id: 'b', label: 'Chorus', startBeat: 10, endBeat: 14, color: '#fff' },
    ];
    // 'b' dragged toward 'a' — should stop right at 'a's endBeat, not overlap.
    const result = moveSection(track, 'b', 1, 64);
    const moved = result.find((s) => s.id === 'b');
    expect(moved?.startBeat).toBe(4);
    expect(moved?.endBeat).toBe(8);
  });

  it('clamps to 0 at the left edge of the timeline', () => {
    const track: ArrangerTrack = [
      { id: 'a', label: 'Verse', startBeat: 10, endBeat: 14, color: '#fff' },
    ];
    const result = moveSection(track, 'a', -50, 64);
    expect(result[0].startBeat).toBe(0);
  });

  it('clamps to totalBeats at the right edge of the timeline', () => {
    const track: ArrangerTrack = [
      { id: 'a', label: 'Verse', startBeat: 0, endBeat: 4, color: '#fff' },
    ];
    const result = moveSection(track, 'a', 1000, 64);
    expect(result[0]).toMatchObject({ startBeat: 60, endBeat: 64 });
  });

  it('is a no-op (same array reference) when the desired position matches the current one', () => {
    const track: ArrangerTrack = [
      { id: 'a', label: 'Verse', startBeat: 4, endBeat: 8, color: '#fff' },
    ];
    expect(moveSection(track, 'a', 4, 64)).toBe(track);
  });

  it('is a no-op when no gap anywhere can fit the section', () => {
    const track: ArrangerTrack = [
      { id: 'a', label: 'Verse', startBeat: 0, endBeat: 4, color: '#fff' },
      { id: 'b', label: 'Chorus', startBeat: 4, endBeat: 60, color: '#fff' },
    ];
    // 'a' is 4 beats long; the only other gap is [60, 64) — also 4 beats, so
    // it *does* fit there; shrink the remaining gap below 4 to prove no-op.
    const tightTrack: ArrangerTrack = [
      { id: 'a', label: 'Verse', startBeat: 0, endBeat: 4, color: '#fff' },
      { id: 'b', label: 'Chorus', startBeat: 4, endBeat: 62, color: '#fff' },
    ];
    expect(moveSection(tightTrack, 'a', 63, 64)).toBe(tightTrack);
    // sanity check on the non-tight variant from the comment above
    const moved = moveSection(track, 'a', 63, 64).find((s) => s.id === 'a');
    expect(moved?.startBeat).toBe(60);
  });

  it('returns the track unchanged for an unknown id', () => {
    const track: ArrangerTrack = [
      { id: 'a', label: 'Verse', startBeat: 0, endBeat: 4, color: '#fff' },
    ];
    expect(moveSection(track, 'missing', 10, 64)).toBe(track);
  });
});

describe('resizeSectionStart', () => {
  it('moves the start edge to the desired beat', () => {
    const track: ArrangerTrack = [
      { id: 'a', label: 'Verse', startBeat: 4, endBeat: 12, color: '#fff' },
    ];
    const result = resizeSectionStart(track, 'a', 6);
    expect(result[0]).toMatchObject({ startBeat: 6, endBeat: 12 });
  });

  it('clamps to the left neighbor', () => {
    const track: ArrangerTrack = [
      { id: 'a', label: 'Verse', startBeat: 0, endBeat: 4, color: '#fff' },
      { id: 'b', label: 'Chorus', startBeat: 8, endBeat: 12, color: '#fff' },
    ];
    const result = resizeSectionStart(track, 'b', 0);
    expect(result.find((s) => s.id === 'b')?.startBeat).toBe(4);
  });

  it('clamps so the section never shrinks below MIN_SECTION_BEATS', () => {
    const track: ArrangerTrack = [
      { id: 'a', label: 'Verse', startBeat: 4, endBeat: 6, color: '#fff' },
    ];
    const result = resizeSectionStart(track, 'a', 5.9);
    expect(result[0].startBeat).toBe(5); // endBeat(6) - MIN_SECTION_BEATS(1)
  });

  it('is a no-op when the desired position matches the current start', () => {
    const track: ArrangerTrack = [
      { id: 'a', label: 'Verse', startBeat: 4, endBeat: 12, color: '#fff' },
    ];
    expect(resizeSectionStart(track, 'a', 4)).toBe(track);
  });
});

describe('resizeSectionEnd', () => {
  it('moves the end edge to the desired beat', () => {
    const track: ArrangerTrack = [
      { id: 'a', label: 'Verse', startBeat: 4, endBeat: 12, color: '#fff' },
    ];
    const result = resizeSectionEnd(track, 'a', 20, 64);
    expect(result[0]).toMatchObject({ startBeat: 4, endBeat: 20 });
  });

  it('clamps to the right neighbor', () => {
    const track: ArrangerTrack = [
      { id: 'a', label: 'Verse', startBeat: 0, endBeat: 4, color: '#fff' },
      { id: 'b', label: 'Chorus', startBeat: 8, endBeat: 12, color: '#fff' },
    ];
    const result = resizeSectionEnd(track, 'a', 20, 64);
    expect(result.find((s) => s.id === 'a')?.endBeat).toBe(8);
  });

  it('clamps to totalBeats when there is no right neighbor', () => {
    const track: ArrangerTrack = [
      { id: 'a', label: 'Verse', startBeat: 0, endBeat: 4, color: '#fff' },
    ];
    const result = resizeSectionEnd(track, 'a', 1000, 64);
    expect(result[0].endBeat).toBe(64);
  });

  it('clamps so the section never shrinks below MIN_SECTION_BEATS', () => {
    const track: ArrangerTrack = [
      { id: 'a', label: 'Verse', startBeat: 4, endBeat: 6, color: '#fff' },
    ];
    const result = resizeSectionEnd(track, 'a', 4.05, 64);
    expect(result[0].endBeat).toBe(5); // startBeat(4) + MIN_SECTION_BEATS(1)
  });

  it('is a no-op when the desired position matches the current end', () => {
    const track: ArrangerTrack = [
      { id: 'a', label: 'Verse', startBeat: 4, endBeat: 12, color: '#fff' },
    ];
    expect(resizeSectionEnd(track, 'a', 12, 64)).toBe(track);
  });
});

describe('updateSection', () => {
  it('updates label and color, leaving the span untouched', () => {
    const track: ArrangerTrack = [
      { id: 'a', label: 'Verse', startBeat: 4, endBeat: 12, color: '#fff' },
    ];
    const result = updateSection(track, 'a', { label: 'Bridge', color: '#000' });
    expect(result[0]).toEqual({
      id: 'a',
      label: 'Bridge',
      startBeat: 4,
      endBeat: 12,
      color: '#000',
    });
  });
});

describe('removeSection', () => {
  it('removes the section with the given id', () => {
    const track: ArrangerTrack = [
      { id: 'a', label: 'Verse', startBeat: 0, endBeat: 4, color: '#fff' },
    ];
    expect(removeSection(track, 'a')).toEqual([]);
  });

  it('is a no-op for an unknown id', () => {
    const track: ArrangerTrack = [
      { id: 'a', label: 'Verse', startBeat: 0, endBeat: 4, color: '#fff' },
    ];
    expect(removeSection(track, 'missing')).toEqual(track);
  });
});
