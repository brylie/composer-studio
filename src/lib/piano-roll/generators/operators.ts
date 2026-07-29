// Application-facing operator registry (generators.md §5, §18 Phase D).
//
// Empty until Phase D migrates generate-chords and implements arpeggiate/
// euclidean-rhythm/ostinato-generate/motif-generate as real operators — the
// session/evaluator plumbing built in Phase B works generically against
// whatever operators are registered here, the same way commandRegistry
// (commands/index.ts) is a plain, authored list rather than something the
// evaluator or session layer needs to know the contents of.

import type { GeneratorOperatorDescriptor } from './types.js';

export const operatorRegistry: ReadonlyMap<string, GeneratorOperatorDescriptor> = new Map();
