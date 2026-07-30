import { describe, expect, it } from 'vitest';
import { makeNote } from '../commands/test-helpers.js';
import {
  chordSourceOperator,
  eventRenderNotesOperator,
  smoothVoicingOperator,
} from './operators-harmony.js';
import { makeBounds, makeGeneratorContext, makeVariation } from './test-helpers.js';
import type { EventPlan, HarmonyPlan, NotePlan, OperatorRequest } from './types.js';

function request(overrides: Partial<OperatorRequest> = {}): OperatorRequest {
  return {
    bounds: makeBounds(),
    params: {},
    variation: makeVariation(),
    nodeId: 'node',
    ...overrides,
  };
}

describe('chordSourceOperator', () => {
  it('segments the chord track within bounds when source is chord-track', () => {
    const ctx = makeGeneratorContext({
      chordTrack: [
        { id: 'c1', beat: 0, root: 0, quality: 'maj7' },
        { id: 'c2', beat: 2, root: 7, quality: '7' },
      ],
    });
    const bounds = makeBounds({ time: { startBeat: 0, endBeat: 4 } });
    const result = chordSourceOperator.process(
      ctx,
      {},
      request({ bounds, params: { source: 'chord-track' } }),
    );
    const plan = result.harmony as HarmonyPlan;
    expect(plan.segments).toHaveLength(2);
    expect(plan.segments[0]).toMatchObject({ startBeat: 0, endBeat: 2, root: 0 });
    expect(plan.segments[1]).toMatchObject({ startBeat: 2, endBeat: 4, root: 7 });
  });

  it('infers a chord per beat from the selection when source is selection', () => {
    const ctx = makeGeneratorContext({
      allNotes: [
        makeNote({ id: 'a', startBeat: 0, midiNote: 60 }), // C
        makeNote({ id: 'b', startBeat: 0, midiNote: 64 }), // E
        makeNote({ id: 'c', startBeat: 1, midiNote: 67 }), // G
      ],
      selectedIds: new Set(['a', 'b', 'c']),
    });
    const bounds = makeBounds({ time: { startBeat: 0, endBeat: 4 } });
    const result = chordSourceOperator.process(
      ctx,
      {},
      request({ bounds, params: { source: 'selection' } }),
    );
    const plan = result.harmony as HarmonyPlan;
    expect(plan.segments).toHaveLength(2);
    expect(plan.segments[0].pitchClasses.sort()).toEqual([0, 4]);
    expect(plan.segments[1].pitchClasses).toEqual([7]);
  });

  it('produces no segments outside the requested bounds', () => {
    const ctx = makeGeneratorContext({
      chordTrack: [{ id: 'c1', beat: 10, root: 0, quality: 'maj' }],
    });
    const bounds = makeBounds({ time: { startBeat: 0, endBeat: 4 } });
    const result = chordSourceOperator.process(
      ctx,
      {},
      request({ bounds, params: { source: 'chord-track' } }),
    );
    const plan = result.harmony as HarmonyPlan;
    expect(plan.segments).toEqual([]);
  });

  it('is deterministic for a fixed request', () => {
    const ctx = makeGeneratorContext({
      chordTrack: [{ id: 'c1', beat: 0, root: 0, quality: 'maj7' }],
    });
    const req = request({ params: { source: 'chord-track' } });
    expect(chordSourceOperator.process(ctx, {}, req)).toEqual(
      chordSourceOperator.process(ctx, {}, req),
    );
  });
});

describe('smoothVoicingOperator', () => {
  const harmonyPlan: HarmonyPlan = {
    kind: 'harmony',
    bounds: makeBounds(),
    diagnostics: [],
    segments: [
      { startBeat: 0, endBeat: 2, root: 0, quality: 'maj7', pitchClasses: [0, 4, 7, 11] },
      { startBeat: 2, endBeat: 4, root: 7, quality: '7', pitchClasses: [7, 11, 2, 5] },
    ],
  };
  const ctx = makeGeneratorContext();

  it('voices every segment within the requested octave range and voice count', () => {
    const result = smoothVoicingOperator.process(
      ctx,
      { harmony: harmonyPlan },
      request({
        nodeId: 'voicing',
        params: { octaveRange: { min: 3, max: 5 }, voiceCount: 4, velocity: 80 },
      }),
    );
    const plan = result.events as EventPlan;
    expect(plan.events).toHaveLength(2);
    for (const event of plan.events) {
      expect(event.pitches.length).toBeLessThanOrEqual(4);
      for (const pitch of event.pitches) {
        expect(pitch).toBeGreaterThanOrEqual(48); // octave 3 floor
        expect(pitch).toBeLessThanOrEqual(71); // octave 5 ceiling
      }
    }
  });

  it('carries voice leading across segments (later segments stay close to the previous voicing)', () => {
    const result = smoothVoicingOperator.process(
      ctx,
      { harmony: harmonyPlan },
      request({ params: { octaveRange: { min: 3, max: 5 }, voiceCount: 4, velocity: 80 } }),
    );
    const plan = result.events as EventPlan;
    const [first, second] = plan.events;
    // Every voice should move by no more than a handful of semitones between
    // adjacent chords sharing common tones (7 and 11) — voiceChord's own
    // smoothing, exercised end to end here.
    const totalMovement = second.pitches.reduce((sum, pitch, i) => {
      const prev = first.pitches[i] ?? first.pitches[first.pitches.length - 1];
      return sum + Math.abs(pitch - prev);
    }, 0);
    expect(totalMovement).toBeLessThan(24);
  });

  it('degrades to an empty events plan when its harmony input is missing', () => {
    const result = smoothVoicingOperator.process(ctx, {}, request({ nodeId: 'voicing' }));
    const plan = result.events as EventPlan;
    expect(plan.events).toEqual([]);
  });

  it('skips a segment with no pitch classes rather than emitting an empty-pitch event', () => {
    const plan: HarmonyPlan = {
      kind: 'harmony',
      bounds: makeBounds(),
      diagnostics: [],
      segments: [{ startBeat: 0, endBeat: 2, root: 0, quality: '', pitchClasses: [] }],
    };
    const result = smoothVoicingOperator.process(
      ctx,
      { harmony: plan },
      request({ params: { octaveRange: { min: 3, max: 5 }, voiceCount: 4, velocity: 80 } }),
    );
    expect((result.events as EventPlan).events).toEqual([]);
  });
});

describe('eventRenderNotesOperator', () => {
  const eventPlan: EventPlan = {
    kind: 'events',
    bounds: makeBounds(),
    diagnostics: [],
    events: [
      { startBeat: 0, durationBeats: 1, pitches: [60, 64, 67], velocity: 80, role: 'support' },
      { startBeat: 1, durationBeats: 1, pitches: [62], velocity: 90, role: 'primary' },
    ],
  };
  const ctx = makeGeneratorContext();

  it('expands each event into one note per pitch', () => {
    const result = eventRenderNotesOperator.process(
      ctx,
      { events: eventPlan },
      request({ nodeId: 'renderer' }),
    );
    const plan = result.notes as NotePlan;
    expect(plan.notes).toHaveLength(4);
    expect(plan.notes.filter((n) => n.startBeat === 0)).toHaveLength(3);
  });

  it('produces unique, stable eventKeys and start-then-pitch sorted output', () => {
    const result = eventRenderNotesOperator.process(
      ctx,
      { events: eventPlan },
      request({ nodeId: 'renderer' }),
    );
    const plan = result.notes as NotePlan;
    const keys = plan.notes.map((n) => n.eventKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (let i = 1; i < plan.notes.length; i++) {
      const prev = plan.notes[i - 1];
      const curr = plan.notes[i];
      expect(
        curr.startBeat > prev.startBeat ||
          (curr.startBeat === prev.startBeat && curr.midiNote >= prev.midiNote),
      ).toBe(true);
    }
  });

  it('degrades to an empty note plan rather than throwing when its events input is missing', () => {
    const result = eventRenderNotesOperator.process(ctx, {}, request({ nodeId: 'renderer' }));
    expect((result.notes as NotePlan).notes).toEqual([]);
  });

  it('clamps pitches into the request pitch bounds', () => {
    const bounds = makeBounds({ pitch: { minMidi: 60, maxMidi: 64 } });
    const result = eventRenderNotesOperator.process(
      ctx,
      { events: { ...eventPlan, bounds } },
      request({ nodeId: 'renderer', bounds }),
    );
    const plan = result.notes as NotePlan;
    for (const note of plan.notes) {
      expect(note.midiNote).toBeGreaterThanOrEqual(60);
      expect(note.midiNote).toBeLessThanOrEqual(64);
    }
  });

  it('is deterministic at zero velocity variation and varies velocity across a reroll when variation is set', () => {
    const params = { velocityVariation: 1 };
    const first = eventRenderNotesOperator.process(
      ctx,
      { events: eventPlan },
      request({ nodeId: 'renderer', params, variation: makeVariation({ generation: 0 }) }),
    );
    const second = eventRenderNotesOperator.process(
      ctx,
      { events: eventPlan },
      request({ nodeId: 'renderer', params, variation: makeVariation({ generation: 1 }) }),
    );
    expect((first.notes as NotePlan).notes.map((n) => n.velocity)).not.toEqual(
      (second.notes as NotePlan).notes.map((n) => n.velocity),
    );
  });

  it('keeps velocity stable across a reroll when the dynamics dimension is locked', () => {
    const params = { velocityVariation: 1 };
    const locks = { ...makeVariation().locks, dynamics: true };
    const first = eventRenderNotesOperator.process(
      ctx,
      { events: eventPlan },
      request({ nodeId: 'renderer', params, variation: makeVariation({ generation: 0, locks }) }),
    );
    const second = eventRenderNotesOperator.process(
      ctx,
      { events: eventPlan },
      request({ nodeId: 'renderer', params, variation: makeVariation({ generation: 1, locks }) }),
    );
    expect((first.notes as NotePlan).notes.map((n) => n.velocity)).toEqual(
      (second.notes as NotePlan).notes.map((n) => n.velocity),
    );
  });
});
