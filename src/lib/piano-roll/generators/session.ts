// Domain layer — generator session lifecycle (generators.md §4.6, §4.7, §5,
// §6, §6.2, §6.4, §12.2). Phase B of generators.md §18: session, layer, and
// playback integration.
//
// A GeneratorSession is application-session state, not document state (§12):
// it lives in the store, not DocumentSnapshot, until Apply converts its
// result into ordinary notes. Every function here is pure — building,
// evaluating, rerolling, and committing a session never touches Svelte
// state, history, or audio directly. The application layer (store.svelte.ts)
// calls these and decides when to re-evaluate and when to record document
// history.

import type { Note } from '../types.js';
import { clampNote } from '../types.js';
import { evaluateGeneratorRecipe } from './evaluator.js';
import { hashToUint32 } from './random.js';
import type {
  GeneratorBounds,
  GeneratorContext,
  GeneratorContextDependency,
  GeneratorContextRevision,
  GeneratorDiagnostic,
  GeneratorOperatorDescriptor,
  GeneratorRecipe,
  GeneratorResult,
  NoteDraft,
  VariationLocks,
  VariationState,
} from './types.js';
import type { GeneratorSessionHistory } from './variation.js';
import {
  createCheckpoint,
  createSessionHistory,
  currentCheckpoint,
  nextCheckpoint,
  previousCheckpoint,
  pushCheckpoint,
} from './variation.js';

// ── Commit mode and source (generators.md §4.6, §4.7) ───────────────────────

export type GeneratorCommitMode = 'insert' | 'replace-selection' | 'replace-bounds';

export type GeneratorSessionSource =
  | { kind: 'timeline-context' }
  | {
      kind: 'captured-notes';
      notes: NoteDraft[];
      /**
       * The original document note ids captured at session start. Not part
       * of generators.md's NoteDraft-only sketch, but needed so
       * `replace-selection` Apply can remove exactly those notes — NoteDraft
       * alone drops id/layerId, and matching by pitch/beat/duration instead
       * would risk deleting an unrelated note that happens to share values.
       */
      sourceNoteIds: string[];
    }
  | { kind: 'layer-range'; startBeat: number; endBeat: number };

export type GeneratorSessionStatus = 'ready' | 'stale' | 'evaluating' | 'error';

/** generators.md §4.7's GeneratorSession. */
export interface GeneratorSession {
  id: string;
  targetLayerId: string;
  name: string;
  bounds: GeneratorBounds;
  recipe: GeneratorRecipe;
  variation: VariationState;
  commitMode: GeneratorCommitMode;
  source: GeneratorSessionSource;
  result: GeneratorResult | null;
  evaluationRevision: number;
  /** Context fingerprint used by the last successful evaluation (generators.md §4.7, §12.2). */
  evaluatedContextRevision: GeneratorContextRevision | null;
  status: GeneratorSessionStatus;
  /** Session-local reroll checkpoints (generators.md §6, §6.4) — never the evaluated notes. */
  history: GeneratorSessionHistory;
}

const DEFAULT_LOCKS: VariationLocks = {
  rhythm: false,
  pitch: false,
  contour: false,
  register: false,
  voicing: false,
  dynamics: false,
};

export interface CreateGeneratorSessionOptions {
  targetLayerId: string;
  name: string;
  bounds: GeneratorBounds;
  recipe: GeneratorRecipe;
  source?: GeneratorSessionSource;
  commitMode?: GeneratorCommitMode;
  locks?: Partial<VariationLocks>;
  /** Overrides the derived-from-crypto initial seed — tests only. */
  seed?: number;
}

/**
 * A brand-new, not-yet-evaluated session (generators.md §6.1 steps 1-2).
 * `status` starts as `'stale'` (needs an evaluation) — callers should run
 * evaluateSession() immediately after to produce the session's first live
 * preview, per §6.1 step 3.
 */
export function createGeneratorSession(options: CreateGeneratorSessionOptions): GeneratorSession {
  return {
    id: crypto.randomUUID(),
    targetLayerId: options.targetLayerId,
    name: options.name,
    bounds: options.bounds,
    recipe: options.recipe,
    variation: {
      // Derived from a fresh crypto UUID rather than Math.random() — generator
      // code must never call Math.random() (generators.md §4.5), and this
      // keeps the one non-deterministic input (a brand-new session's initial
      // seed) on the same seeded-randomness rails as everything downstream.
      seed: options.seed ?? hashToUint32(crypto.randomUUID()),
      generation: 0,
      locks: { ...DEFAULT_LOCKS, ...options.locks },
    },
    commitMode: options.commitMode ?? 'insert',
    source: options.source ?? { kind: 'timeline-context' },
    result: null,
    evaluationRevision: 0,
    evaluatedContextRevision: null,
    status: 'stale',
    history: createSessionHistory(),
  };
}

// ── Context revisions and staleness (generators.md §4.7, §6.2, §12.2) ───────

/**
 * Content-fingerprint revisions rather than incrementing counters threaded
 * through the whole store: a plain-data GeneratorContext already carries
 * everything a fingerprint needs, so this stays a pure function of `ctx`
 * instead of requiring the application layer to maintain a revision counter
 * per track. Equal content always hashes equal, so editing a track and then
 * undoing back to the original content correctly un-marks a session as stale.
 */
export function computeContextRevision(ctx: GeneratorContext): GeneratorContextRevision {
  return {
    scaleTrackRevision: hashToUint32(JSON.stringify(ctx.scaleTrack)),
    chordTrackRevision: hashToUint32(JSON.stringify(ctx.chordTrack)),
    sourceNotesRevision: hashToUint32(JSON.stringify(ctx.notes)),
    timeSignatureTrackRevision: hashToUint32(JSON.stringify(ctx.timeSignatureTrack)),
  };
}

const DEPENDENCY_REVISION_KEYS: Record<
  GeneratorContextDependency,
  (keyof GeneratorContextRevision)[]
> = {
  'active-scale': ['scaleTrackRevision'],
  'scale-track': ['scaleTrackRevision'],
  'active-chord': ['chordTrackRevision'],
  'chord-track': ['chordTrackRevision'],
  selection: ['sourceNotesRevision'],
};

/** The union of contextDependencies declared by every node's operator in the recipe. */
export function declaredDependencies(
  recipe: GeneratorRecipe,
  operators: ReadonlyMap<string, GeneratorOperatorDescriptor>,
): ReadonlySet<GeneratorContextDependency> {
  const deps = new Set<GeneratorContextDependency>();
  for (const node of recipe.nodes) {
    for (const dep of operators.get(node.operatorId)?.contextDependencies ?? []) {
      deps.add(dep);
    }
  }
  return deps;
}

/**
 * True when a context dependency the recipe actually declares has changed
 * since the session's last successful evaluation (generators.md §6.2:
 * "unrelated track changes must not mark the session stale"). `evaluated ===
 * null` means nothing has evaluated yet — a distinct pre-evaluation state,
 * not staleness, so it always returns `false`.
 */
export function isContextRevisionStale(
  declared: ReadonlySet<GeneratorContextDependency>,
  evaluated: GeneratorContextRevision | null,
  current: GeneratorContextRevision,
): boolean {
  if (!evaluated) return false;
  for (const dep of declared) {
    for (const key of DEPENDENCY_REVISION_KEYS[dep]) {
      if (evaluated[key] !== current[key]) return true;
    }
  }
  return false;
}

// ── Evaluation (generators.md §5, §6.2) ─────────────────────────────────────

export interface SessionEvaluationOutcome {
  session: GeneratorSession;
  /**
   * Diagnostics from this evaluation attempt specifically — including a
   * failed attempt's, which otherwise go nowhere: generators.md §6.2 says a
   * failed evaluation keeps the session's previous successful result and
   * evaluatedContextRevision untouched, so those diagnostics never end up in
   * `session.result.diagnostics`.
   */
  diagnostics: GeneratorDiagnostic[];
}

/**
 * Runs the recipe evaluator for the session's current bounds/recipe/variation
 * and folds the outcome back in (generators.md §5, §6.2): on success, stores
 * the new result, bumps evaluationRevision, records the context revision it
 * was evaluated against, and sets status to 'ready'. On failure, the
 * previous result and evaluatedContextRevision are left untouched and only
 * `status` flips to 'error'.
 */
export function evaluateSession(
  ctx: GeneratorContext,
  session: GeneratorSession,
  contextRevision: GeneratorContextRevision,
  operators: ReadonlyMap<string, GeneratorOperatorDescriptor>,
): SessionEvaluationOutcome {
  const result = evaluateGeneratorRecipe(
    ctx,
    {
      bounds: session.bounds,
      recipe: session.recipe,
      variation: session.variation,
      contextRevision,
    },
    operators,
  );
  // Every error diagnostic *except* max-notes-exceeded means the evaluator
  // couldn't produce a trustworthy result (invalid recipe/bounds, a cycle, an
  // operator emitting out-of-bounds/non-finite notes, ...) — generators.md
  // §6.2's "failed evaluation". max-notes-exceeded is deliberately excluded:
  // per §14, exceeding the preview cap is "a diagnostic and no preview"
  // *of an otherwise-successful evaluation*, not a broken one, so the
  // session still moves to 'ready' with its (now empty) result.
  const failed = result.diagnostics.some(
    (d) => d.level === 'error' && d.code !== 'max-notes-exceeded',
  );
  if (failed) {
    return { session: { ...session, status: 'error' }, diagnostics: result.diagnostics };
  }
  return {
    session: {
      ...session,
      result,
      evaluationRevision: session.evaluationRevision + 1,
      evaluatedContextRevision: contextRevision,
      status: 'ready',
    },
    diagnostics: result.diagnostics,
  };
}

// ── Reroll and variation history (generators.md §6, §6.4, §10) ─────────────

/**
 * Advances the session to a new generation and records a compact checkpoint
 * — never the evaluated notes themselves (generators.md §6.4). Locked
 * dimensions stay stable because each operator derives its own sub-seed from
 * `variation.seed` (generation-independent) when its dimension is locked —
 * see random.ts's deriveSeed doc comment — so bumping `generation` alone is
 * enough; this function doesn't need to know which dimensions are locked.
 * Callers should run evaluateSession() next to actually recompute.
 */
export function rerollSession(
  session: GeneratorSession,
  randomizedParams?: Record<string, unknown>,
): GeneratorSession {
  const variation: VariationState = {
    ...session.variation,
    generation: session.variation.generation + 1,
  };
  const checkpoint = createCheckpoint(variation, randomizedParams);
  return { ...session, variation, history: pushCheckpoint(session.history, checkpoint) };
}

/**
 * Moves session-local variation history and restores that checkpoint's
 * seed/generation (generators.md §6.4's Previous/Next Variation). A no-op at
 * either end of history. Locks aren't part of a checkpoint (only
 * seed/generation/randomizedParams are, per generators.md §6) so the
 * session's current locks are left as-is. Callers should run
 * evaluateSession() next to recompute.
 */
export function stepVariationHistory(
  session: GeneratorSession,
  direction: 'previous' | 'next',
): GeneratorSession {
  const history =
    direction === 'previous'
      ? previousCheckpoint(session.history)
      : nextCheckpoint(session.history);
  const checkpoint = currentCheckpoint(history);
  if (!checkpoint) return session;
  return {
    ...session,
    history,
    variation: { ...session.variation, seed: checkpoint.seed, generation: checkpoint.generation },
  };
}

export function setVariationLocks(
  session: GeneratorSession,
  locks: Partial<VariationLocks>,
): GeneratorSession {
  return {
    ...session,
    variation: { ...session.variation, locks: { ...session.variation.locks, ...locks } },
  };
}

export function setSessionBounds(
  session: GeneratorSession,
  bounds: GeneratorBounds,
): GeneratorSession {
  return { ...session, bounds };
}

export function setSessionRecipe(
  session: GeneratorSession,
  recipe: GeneratorRecipe,
): GeneratorSession {
  return { ...session, recipe };
}

export function setSessionCommitMode(
  session: GeneratorSession,
  commitMode: GeneratorCommitMode,
): GeneratorSession {
  return { ...session, commitMode };
}

// ── Commit (generators.md §4.6, §5) ─────────────────────────────────────────

/**
 * Which of the target layer's committed notes Apply removes before adding
 * the session's result, per commitMode (generators.md §4.6). `insert` keeps
 * everything. `replace-selection` removes exactly the captured source notes
 * (only meaningful for a `captured-notes` session; a no-op otherwise).
 * `replace-bounds` removes every committed note on the target layer whose
 * time AND pitch overlap the session's own bounds.
 */
function notesToRemove(session: GeneratorSession, allNotes: Note[]): ReadonlySet<string> {
  if (session.commitMode === 'insert') return new Set();

  if (session.commitMode === 'replace-selection') {
    return session.source.kind === 'captured-notes'
      ? new Set(session.source.sourceNoteIds)
      : new Set();
  }

  const { time, pitch } = session.bounds;
  const overlapping = allNotes.filter(
    (n) =>
      n.layerId === session.targetLayerId &&
      n.startBeat < time.endBeat &&
      n.startBeat + n.durationBeats > time.startBeat &&
      n.midiNote >= pitch.minMidi &&
      n.midiNote <= pitch.maxMidi,
  );
  return new Set(overlapping.map((n) => n.id));
}

/** Merges freshly committed notes into the document's notes per commitMode (generators.md §4.6). */
export function mergeGeneratedNotes(
  allNotes: Note[],
  committed: Note[],
  session: GeneratorSession,
): Note[] {
  const toRemove = notesToRemove(session, allNotes);
  const kept = toRemove.size === 0 ? allNotes : allNotes.filter((n) => !toRemove.has(n.id));
  return [...kept, ...committed];
}

/**
 * Converts the session's current evaluated result into permanent, clamped
 * notes on the target layer and merges them into the document (generators.md
 * §5's commitGeneratorResult, §4.6's Apply). Returns the same
 * `{ notes, label }` shape store.svelte.ts's applyCommandResult already
 * expects for every other command, so Apply reuses the existing
 * whole-document mutation/history path rather than a generator-specific one.
 */
export function commitGeneratorResult(
  allNotes: Note[],
  session: GeneratorSession,
): { notes: Note[]; label: string } {
  const drafts = session.result?.notes ?? [];
  // Built explicitly from NoteDraft's own fields (not a rest-destructure of
  // GeneratedNoteDraft) so eventKey/role/sourceStep — preview-only, per
  // generators.md §4.4 — are dropped without an unused-variable lint finding.
  const committed = drafts.map((draft) =>
    clampNote({
      midiNote: draft.midiNote,
      startBeat: draft.startBeat,
      durationBeats: draft.durationBeats,
      velocity: draft.velocity,
      id: crypto.randomUUID(),
      layerId: session.targetLayerId,
    }),
  );
  return { notes: mergeGeneratedNotes(allNotes, committed, session), label: 'Apply generator' };
}
