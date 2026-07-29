import { describe, expect, it } from 'vitest';
import { makeCommandContext } from '../commands/test-helpers.js';
import { createGeneratorContext } from './context.js';
import {
  commitGeneratorResult,
  computeContextRevision,
  createGeneratorSession,
  declaredDependencies,
  evaluateSession,
  isContextRevisionStale,
  mergeGeneratedNotes,
  rerollSession,
  setSessionBounds,
  setVariationLocks,
  stepVariationHistory,
} from './session.js';
import {
  makeBounds,
  makeGeneratorContext,
  makeManyNotesSourceOperator,
  makeNoteDraft,
  makeOperatorMap,
  makeSeededPitchSourceOperator,
  makeSourceOperator,
} from './test-helpers.js';
import type { GeneratorRecipe } from './types.js';

function makeOneNodeRecipe(operatorId: string, version = 1): GeneratorRecipe {
  return {
    id: 'recipe-1',
    version: 1,
    nodes: [{ id: 'n1', operatorId, operatorVersion: version, params: {}, enabled: true }],
    edges: [],
    output: { nodeId: 'n1', port: 'out' },
  };
}

describe('createGeneratorSession', () => {
  it('starts stale, unevaluated, and with a default insert commit mode', () => {
    const session = createGeneratorSession({
      targetLayerId: 'layer-1',
      name: 'Test',
      bounds: makeBounds(),
      recipe: makeOneNodeRecipe('src'),
    });
    expect(session.status).toBe('stale');
    expect(session.result).toBeNull();
    expect(session.evaluationRevision).toBe(0);
    expect(session.evaluatedContextRevision).toBeNull();
    expect(session.commitMode).toBe('insert');
    expect(session.source).toEqual({ kind: 'timeline-context' });
    expect(session.variation.generation).toBe(0);
    expect(session.variation.locks.pitch).toBe(false);
  });

  it('derives a seed deterministically from an injected seed, for reproducible tests', () => {
    const session = createGeneratorSession({
      targetLayerId: 'layer-1',
      name: 'Test',
      bounds: makeBounds(),
      recipe: makeOneNodeRecipe('src'),
      seed: 42,
    });
    expect(session.variation.seed).toBe(42);
  });
});

describe('evaluateSession', () => {
  it('evaluates the recipe and marks the session ready on success', () => {
    const notes = [makeNoteDraft({ eventKey: 'n:0', midiNote: 64 })];
    const operators = makeOperatorMap(makeSourceOperator('src', notes));
    const session = createGeneratorSession({
      targetLayerId: 'layer-1',
      name: 'Test',
      bounds: makeBounds(),
      recipe: makeOneNodeRecipe('src'),
    });
    const ctx = makeGeneratorContext();
    const revision = computeContextRevision(ctx);
    const outcome = evaluateSession(ctx, session, revision, operators);

    expect(outcome.session.status).toBe('ready');
    expect(outcome.session.result?.notes).toEqual(notes);
    expect(outcome.session.evaluationRevision).toBe(1);
    expect(outcome.session.evaluatedContextRevision).toEqual(revision);
  });

  it('flips status to error and preserves the previous result on a failed evaluation', () => {
    const notes = [makeNoteDraft({ eventKey: 'n:0', midiNote: 64 })];
    const operators = makeOperatorMap(makeSourceOperator('src', notes));
    let session = createGeneratorSession({
      targetLayerId: 'layer-1',
      name: 'Test',
      bounds: makeBounds(),
      recipe: makeOneNodeRecipe('src'),
    });
    const ctx = makeGeneratorContext();
    const goodRevision = computeContextRevision(ctx);
    session = evaluateSession(ctx, session, goodRevision, operators).session;
    expect(session.status).toBe('ready');

    // Break the recipe (references an unregistered operator id) — the next
    // evaluation should fail without disturbing the previous good result.
    const brokenSession = { ...session, recipe: makeOneNodeRecipe('missing-operator') };
    const outcome = evaluateSession(ctx, brokenSession, goodRevision, operators);

    expect(outcome.session.status).toBe('error');
    expect(outcome.diagnostics.some((d) => d.level === 'error')).toBe(true);
    // Untouched from the prior successful evaluation:
    expect(outcome.session.result?.notes).toEqual(notes);
    expect(outcome.session.evaluationRevision).toBe(1);
    expect(outcome.session.evaluatedContextRevision).toEqual(goodRevision);
  });

  it('drops the preview when the note-count limit is exceeded, without crashing', () => {
    const operators = makeOperatorMap(makeManyNotesSourceOperator('src', 3000));
    const session = createGeneratorSession({
      targetLayerId: 'layer-1',
      name: 'Test',
      bounds: makeBounds(),
      recipe: makeOneNodeRecipe('src'),
    });
    const ctx = makeGeneratorContext();
    const revision = computeContextRevision(ctx);
    const outcome = evaluateSession(ctx, session, revision, operators);
    expect(outcome.session.status).toBe('ready');
    expect(outcome.session.result?.notes).toEqual([]);
    expect(outcome.diagnostics.some((d) => d.code === 'max-notes-exceeded')).toBe(true);
  });
});

describe('context revision staleness', () => {
  it('is not stale before any evaluation has happened', () => {
    expect(
      isContextRevisionStale(
        new Set(['scale-track']),
        null,
        computeContextRevision(makeGeneratorContext()),
      ),
    ).toBe(false);
  });

  it('is unaffected by a track the recipe does not declare a dependency on', () => {
    const before = makeGeneratorContext();
    const evaluated = computeContextRevision(before);
    const after = createGeneratorContext(
      makeCommandContext([], new Set(), {
        chordTrack: [{ id: 'c1', beat: 0, root: 0, quality: 'maj' }],
      }),
      [],
      [],
      [],
    );
    const current = computeContextRevision(after);
    // Recipe only declares 'scale-track' — a chord-track-only change must not matter.
    expect(isContextRevisionStale(new Set(['scale-track']), evaluated, current)).toBe(false);
  });

  it('is stale when a declared dependency actually changed', () => {
    const before = makeGeneratorContext();
    const evaluated = computeContextRevision(before);
    const after = createGeneratorContext(
      makeCommandContext([], new Set(), {
        chordTrack: [{ id: 'c1', beat: 0, root: 0, quality: 'maj' }],
      }),
      [],
      [],
      [],
    );
    const current = computeContextRevision(after);
    expect(isContextRevisionStale(new Set(['chord-track']), evaluated, current)).toBe(true);
  });

  it('collects declared dependencies from every node in the recipe', () => {
    const operators = makeOperatorMap({
      ...makeSourceOperator('src', []),
      contextDependencies: ['scale-track'],
    });
    const deps = declaredDependencies(makeOneNodeRecipe('src'), operators);
    expect(deps).toEqual(new Set(['scale-track']));
  });
});

describe('rerollSession / stepVariationHistory', () => {
  it('reroll bumps generation and records a checkpoint, leaving locks untouched', () => {
    const session = setVariationLocks(
      createGeneratorSession({
        targetLayerId: 'layer-1',
        name: 'Test',
        bounds: makeBounds(),
        recipe: makeOneNodeRecipe('src'),
        seed: 1,
      }),
      { rhythm: true },
    );
    const rerolled = rerollSession(session);
    expect(rerolled.variation.generation).toBe(1);
    expect(rerolled.variation.seed).toBe(1);
    expect(rerolled.variation.locks.rhythm).toBe(true);
    expect(rerolled.history.checkpoints).toEqual([{ seed: 1, generation: 1 }]);
  });

  it('a locked dimension is stable across a reroll, an unlocked one varies', () => {
    const operators = makeOperatorMap(makeSeededPitchSourceOperator('src'));
    const ctx = makeGeneratorContext();
    const revision = computeContextRevision(ctx);
    const base = createGeneratorSession({
      targetLayerId: 'layer-1',
      name: 'Test',
      bounds: makeBounds(),
      recipe: makeOneNodeRecipe('src'),
      seed: 7,
    });

    const unlocked = evaluateSession(ctx, base, revision, operators).session;
    const unlockedRerolled = evaluateSession(
      ctx,
      rerollSession(unlocked),
      revision,
      operators,
    ).session;
    expect(unlockedRerolled.result?.notes[0].midiNote).not.toBe(unlocked.result?.notes[0].midiNote);

    const locked = setVariationLocks(base, { pitch: true });
    const lockedEvaluated = evaluateSession(ctx, locked, revision, operators).session;
    const lockedRerolled = evaluateSession(
      ctx,
      rerollSession(lockedEvaluated),
      revision,
      operators,
    ).session;
    expect(lockedRerolled.result?.notes[0].midiNote).toBe(
      lockedEvaluated.result?.notes[0].midiNote,
    );
  });

  it('previous/next variation navigate checkpoints and restore seed/generation', () => {
    let session = createGeneratorSession({
      targetLayerId: 'layer-1',
      name: 'Test',
      bounds: makeBounds(),
      recipe: makeOneNodeRecipe('src'),
      seed: 1,
    });
    session = rerollSession(session);
    session = rerollSession(session);
    expect(session.variation.generation).toBe(2);

    const back = stepVariationHistory(session, 'previous');
    expect(back.variation.generation).toBe(1);

    const forward = stepVariationHistory(back, 'next');
    expect(forward.variation.generation).toBe(2);
  });

  it('is a no-op at either end of variation history', () => {
    const session = createGeneratorSession({
      targetLayerId: 'layer-1',
      name: 'Test',
      bounds: makeBounds(),
      recipe: makeOneNodeRecipe('src'),
      seed: 1,
    });
    expect(stepVariationHistory(session, 'previous')).toBe(session);
    expect(stepVariationHistory(session, 'next')).toBe(session);
  });
});

describe('setSessionBounds', () => {
  it('replaces bounds without touching anything else', () => {
    const session = createGeneratorSession({
      targetLayerId: 'layer-1',
      name: 'Test',
      bounds: makeBounds(),
      recipe: makeOneNodeRecipe('src'),
    });
    const nextBounds = makeBounds({ time: { startBeat: 4, endBeat: 8 } });
    const updated = setSessionBounds(session, nextBounds);
    expect(updated.bounds).toEqual(nextBounds);
    expect(updated.recipe).toBe(session.recipe);
  });
});

describe('mergeGeneratedNotes / commitGeneratorResult', () => {
  const targetLayerId = 'layer-1';

  function sessionWithResult(
    overrides: Partial<Parameters<typeof createGeneratorSession>[0]> = {},
    notes = [makeNoteDraft({ eventKey: 'n:0', midiNote: 67, startBeat: 0 })],
  ) {
    const session = createGeneratorSession({
      targetLayerId,
      name: 'Test',
      bounds: makeBounds(),
      recipe: makeOneNodeRecipe('src'),
      ...overrides,
    });
    return {
      ...session,
      result: {
        output: { kind: 'notes' as const, bounds: session.bounds, diagnostics: [], notes },
        notes,
        diagnostics: [],
      },
    };
  }

  it('insert keeps every existing note and appends the committed ones', () => {
    const existing = [
      {
        id: 'e1',
        midiNote: 60,
        startBeat: 0,
        durationBeats: 1,
        velocity: 90,
        layerId: targetLayerId,
      },
    ];
    const session = sessionWithResult({ commitMode: 'insert' });
    const result = commitGeneratorResult(existing, session);
    expect(result.notes).toHaveLength(2);
    expect(result.notes[0]).toEqual(existing[0]);
    expect(result.notes[1].midiNote).toBe(67);
    expect(result.notes[1].layerId).toBe(targetLayerId);
    expect(result.label).toBe('Apply generator');
  });

  it('replace-selection removes exactly the captured source note ids on the target layer', () => {
    const kept = {
      id: 'keep',
      midiNote: 60,
      startBeat: 0,
      durationBeats: 1,
      velocity: 90,
      layerId: targetLayerId,
    };
    const removed = {
      id: 'remove',
      midiNote: 62,
      startBeat: 1,
      durationBeats: 1,
      velocity: 90,
      layerId: targetLayerId,
    };
    const session = sessionWithResult({
      commitMode: 'replace-selection',
      source: { kind: 'captured-notes', notes: [], sourceNoteIds: ['remove'] },
    });
    const result = commitGeneratorResult([kept, removed], session);
    expect(result.notes.map((n) => n.id)).not.toContain('remove');
    expect(result.notes.map((n) => n.id)).toContain('keep');
  });

  it('replace-bounds removes only target-layer notes overlapping the session bounds', () => {
    const bounds = makeBounds({
      time: { startBeat: 0, endBeat: 4 },
      pitch: { minMidi: 60, maxMidi: 72 },
    });
    const insideBounds = {
      id: 'inside',
      midiNote: 64,
      startBeat: 1,
      durationBeats: 1,
      velocity: 90,
      layerId: targetLayerId,
    };
    const outsideTime = {
      id: 'outside-time',
      midiNote: 64,
      startBeat: 10,
      durationBeats: 1,
      velocity: 90,
      layerId: targetLayerId,
    };
    const outsidePitch = {
      id: 'outside-pitch',
      midiNote: 30,
      startBeat: 1,
      durationBeats: 1,
      velocity: 90,
      layerId: targetLayerId,
    };
    const otherLayer = {
      id: 'other-layer',
      midiNote: 64,
      startBeat: 1,
      durationBeats: 1,
      velocity: 90,
      layerId: 'other',
    };
    const session = sessionWithResult({ commitMode: 'replace-bounds', bounds });
    const result = mergeGeneratedNotes(
      [insideBounds, outsideTime, outsidePitch, otherLayer],
      [],
      session,
    );
    const ids = result.map((n) => n.id);
    expect(ids).not.toContain('inside');
    expect(ids).toEqual(expect.arrayContaining(['outside-time', 'outside-pitch', 'other-layer']));
  });

  it('strips eventKey/role/sourceStep and assigns a fresh id + the target layer id', () => {
    const session = sessionWithResult({}, [
      makeNoteDraft({ eventKey: 'n:0', midiNote: 67, role: 'primary', sourceStep: 2 }),
    ]);
    const result = commitGeneratorResult([], session);
    const [note] = result.notes;
    expect(note).not.toHaveProperty('eventKey');
    expect(note).not.toHaveProperty('role');
    expect(note).not.toHaveProperty('sourceStep');
    expect(note.layerId).toBe(targetLayerId);
    expect(typeof note.id).toBe('string');
    expect(note.id.length).toBeGreaterThan(0);
  });
});
