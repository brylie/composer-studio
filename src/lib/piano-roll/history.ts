import type { DocumentSnapshot, Note } from './types.js';

// ── isContiguous ───────────────────────────────────────────────────────────────

/**
 * True when the union of note intervals has no gaps. Uses union-coverage
 * (not naive pairwise) so a note spanning shorter neighbours does not
 * falsely report a gap. Sorts a copy by `startBeat` internally, so callers
 * don't have to guarantee pre-sorted input for a correct result.
 */
export function isContiguous(notes: Note[]): boolean {
  if (notes.length === 0) return true;
  const sorted = notes.slice().sort((a, b) => a.startBeat - b.startBeat);
  let coveredUntil = -Infinity;
  for (const note of sorted) {
    if (note.startBeat > coveredUntil) {
      if (coveredUntil !== -Infinity) return false;
    }
    coveredUntil = Math.max(coveredUntil, note.startBeat + note.durationBeats);
  }
  return true;
}

// ── CommandHistory ─────────────────────────────────────────────────────────────

/**
 * Pure (non-reactive) undo/redo stack. `canUndo` and `canRedo` are plain
 * getters — reactivity is the caller's (store.svelte.ts) responsibility.
 * Keeping this in plain TypeScript makes it unit-testable without a Svelte
 * runtime and coverable by v8/istanbul.
 */
export class CommandHistory {
  readonly #undoStack: DocumentSnapshot[] = [];
  readonly #redoStack: DocumentSnapshot[] = [];
  readonly #maxDepth: number;

  constructor(maxDepth = 50) {
    this.#maxDepth = maxDepth;
  }

  get canUndo(): boolean {
    return this.#undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.#redoStack.length > 0;
  }

  get undoLabel(): string | undefined {
    return this.#undoStack[this.#undoStack.length - 1]?.label;
  }

  get redoLabel(): string | undefined {
    return this.#redoStack[this.#redoStack.length - 1]?.label;
  }

  /**
   * Call BEFORE mutating state. `snapshot` must return plain data —
   * use `structuredClone` or `$state.snapshot()` on the caller side,
   * not a live reactive proxy.
   */
  record(label: string, snapshot: () => Omit<DocumentSnapshot, 'label'>): void {
    this.#undoStack.push(structuredClone({ ...snapshot(), label }));
    this.#redoStack.length = 0;
    if (this.#undoStack.length > this.#maxDepth) this.#undoStack.shift();
  }

  undo(current: () => Omit<DocumentSnapshot, 'label'>): DocumentSnapshot | undefined {
    const entry = this.#undoStack.pop();
    if (!entry) return;
    this.#redoStack.push(structuredClone({ ...current(), label: entry.label }));
    return entry;
  }

  redo(current: () => Omit<DocumentSnapshot, 'label'>): DocumentSnapshot | undefined {
    const entry = this.#redoStack.pop();
    if (!entry) return;
    this.#undoStack.push(structuredClone({ ...current(), label: entry.label }));
    return entry;
  }
}
