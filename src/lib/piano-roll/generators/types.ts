// Domain layer — generator domain and evaluation types (generators.md §4-§6, §11).
//
// Phase A: the data shapes and evaluator contract shared by every
// generator/operator. Session lifecycle (GeneratorSession, commit mode,
// staleness) now live in session.ts (Phase B). The catalog-facing
// GeneratorDescriptor is Phase C/D and still deliberately not defined here.

import type { ScaleEvent, TimeSignatureEvent } from '../timeline.js';
import type { CommandContext, Note } from '../types.js';

// ── Families (generators.md §4.1) ───────────────────────────────────────────

export type GeneratorFamily =
  | 'rhythm'
  | 'pitch'
  | 'motif'
  | 'arpeggio'
  | 'harmony'
  | 'voicing'
  | 'bass'
  | 'ostinato'
  | 'accompaniment';

// ── Bounds (generators.md §4.3) ─────────────────────────────────────────────

export interface GeneratorBounds {
  time: {
    startBeat: number;
    endBeat: number;
  };
  pitch: {
    minMidi: number;
    maxMidi: number;
  };
  /** Authoritative policy for notes sustained beyond time.endBeat. */
  allowTail: boolean;
}

// ── Note drafts (generators.md §4.4) ────────────────────────────────────────

export type NoteDraft = Omit<Note, 'id' | 'layerId'>;

export interface GeneratedNoteDraft extends NoteDraft {
  /** Stable within a session evaluation; used for keyed rendering and scheduling. */
  eventKey: string;
  role?: 'primary' | 'support' | 'bass' | 'voice' | 'accent';
  sourceStep?: number;
}

// ── Seeded variation (generators.md §4.5) ───────────────────────────────────

export interface VariationLocks {
  rhythm: boolean;
  pitch: boolean;
  contour: boolean;
  register: boolean;
  voicing: boolean;
  dynamics: boolean;
}

export interface VariationState {
  seed: number;
  generation: number;
  locks: VariationLocks;
}

/** A compact reroll checkpoint (generators.md §6, §6.4) — never stores generated notes. */
export interface VariationCheckpoint {
  seed: number;
  generation: number;
  randomizedParams?: Record<string, unknown>;
}

// ── Diagnostics ──────────────────────────────────────────────────────────────

export interface GeneratorDiagnostic {
  level: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  nodeId?: string;
  port?: string;
}

// ── Music plan (generators.md §4.8) ─────────────────────────────────────────

export type MusicPlanKind = 'harmony' | 'rhythm' | 'pitch' | 'events' | 'notes';

export interface MusicPlanBase {
  kind: MusicPlanKind;
  bounds: GeneratorBounds;
  diagnostics: GeneratorDiagnostic[];
}

export interface HarmonyPlan extends MusicPlanBase {
  kind: 'harmony';
  segments: {
    startBeat: number;
    endBeat: number;
    root: number;
    quality: string;
    pitchClasses: number[];
    function?: string;
  }[];
}

export interface RhythmPlan extends MusicPlanBase {
  kind: 'rhythm';
  events: {
    startBeat: number;
    durationBeats: number;
    accent: number;
  }[];
}

export interface PitchPlan extends MusicPlanBase {
  kind: 'pitch';
  pitches: {
    midiNote: number;
    degree?: number;
    sourceStep?: number;
    role?: string;
  }[];
}

export interface EventPlan extends MusicPlanBase {
  kind: 'events';
  events: {
    startBeat: number;
    durationBeats: number;
    pitches: number[];
    velocity: number;
    role?: string;
  }[];
}

export interface NotePlan extends MusicPlanBase {
  kind: 'notes';
  notes: GeneratedNoteDraft[];
}

export type MusicPlan = HarmonyPlan | RhythmPlan | PitchPlan | EventPlan | NotePlan;

// ── Operators, ports, and recipes (generators.md §4.9, §4.10, §11) ─────────

export interface PlanPort {
  kind: MusicPlanKind;
  optional?: boolean;
  multiple?: boolean;
}

export type GeneratorContextDependency =
  | 'active-scale'
  | 'scale-track'
  | 'active-chord'
  | 'chord-track'
  | 'selection'
  | 'time-signature-track';

/** What createGeneratorContext(ctx, ...) builds (generators.md §5) — CommandContext plus what generators need beyond the selection itself. */
export interface GeneratorContext extends CommandContext {
  targetLayerId: string;
  layerNotes: Note[];
  scaleTrack: ScaleEvent[];
  timeSignatureTrack: TimeSignatureEvent[];
}

export interface OperatorRequest<
  TParams extends Record<string, unknown> = Record<string, unknown>,
> {
  bounds: GeneratorBounds;
  params: TParams;
  variation: VariationState;
  nodeId: string;
}

export interface GeneratorOperatorDescriptor<
  TParams extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string;
  version: number;
  label: string;
  role: 'source' | 'processor' | 'realizer' | 'merge' | 'renderer';
  inputs: Record<string, PlanPort>;
  outputs: Record<string, PlanPort>;
  contextDependencies?: GeneratorContextDependency[];
  getDefaultParams(ctx: GeneratorContext): TParams;
  process(
    ctx: GeneratorContext,
    inputs: Record<string, MusicPlan | MusicPlan[]>,
    request: OperatorRequest<TParams>,
  ): Record<string, MusicPlan | MusicPlan[]>;
}

export interface GeneratorNodeInstance {
  id: string;
  operatorId: string;
  operatorVersion: number;
  params: Record<string, unknown>;
  enabled: boolean;
}

export interface GeneratorEdge {
  from: { nodeId: string; port: string };
  to: { nodeId: string; port: string };
}

/** A directed acyclic graph of operator nodes. V1 rejects cycles (generators.md §4.9). */
export interface GeneratorRecipe {
  id: string;
  version: number;
  nodes: GeneratorNodeInstance[];
  edges: GeneratorEdge[];
  output: { nodeId: string; port: string };
}

// ── Evaluation (generators.md §5) ───────────────────────────────────────────

/** Context fingerprint compared against a session's evaluatedContextRevision (generators.md §4.7, §12.2). */
export interface GeneratorContextRevision {
  scaleTrackRevision?: number;
  chordTrackRevision?: number;
  sourceNotesRevision?: number;
  timeSignatureTrackRevision?: number;
}

export interface GeneratorEvaluationRequest {
  bounds: GeneratorBounds;
  recipe: GeneratorRecipe;
  variation: VariationState;
  contextRevision: GeneratorContextRevision;
  includeTrace?: boolean;
}

export interface GeneratorResult {
  output: MusicPlan;
  notes: GeneratedNoteDraft[]; // populated by the final note renderer
  diagnostics: GeneratorDiagnostic[];
  trace?: {
    nodeId: string;
    outputs: Record<string, MusicPlan | MusicPlan[]>;
  }[];
}
