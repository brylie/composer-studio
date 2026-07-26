# Performance Specification

## Status: deferred

No profiling has happened — nothing in this codebase is slow yet, because
there isn't much of it yet. This is a placeholder naming the areas most
likely to need attention later, so they're not rediscovered from scratch, not
a set of tuned targets to build against now.

---

## Areas likely to need attention eventually

1. **Note grid rendering at scale** — hundreds/thousands of notes, each
   presumably its own DOM element. Likely fix: only render notes within (or
   just outside) the visible beat range. See
   [piano-roll.md](./piano-roll.md#note-grid--main-scrollable-canvas).
2. **Event-track lane rendering** — same concern for scale/chord/label/
   arranger lanes over a long timeline, see [tracks.md](./tracks.md).
3. **`SelectionContext` recomputation** — the `$derived.by` in
   [selection.md](./selection.md#selectioncontext--what-transformations-actually-read)
   sorts and filters the full note array on every selection or note-array
   change. Fine at small scale; revisit if profiling shows it's hot.
4. **Whole-document undo snapshots** — [command-history.md](./command-history.md#generalising-beyond-note)
   already names this trade-off explicitly ("revisit only if profiling says
   otherwise") — repeated here so it's not missed in a performance sweep.
5. **Command applicability re-evaluation** — every ribbon button's
   `isApplicable()` recomputes on each selection change. Trivial at the
   current catalog size; could matter if the registry grows substantially
   (the explicit goal of [transformations.md](./transformations.md) is
   external contribution, which could grow it a lot).
6. **Autosave writes** — [persistence.md](./persistence.md) debounces to one
   write per history entry, but a full-document IndexedDB write on every
   entry could matter for very large documents.

---

## Trigger conditions to revisit

- A real composition (not a synthetic stress test) becomes noticeably
  laggy to scroll or edit.
- Profiling — not guessing — identifies one of the above as the actual
  bottleneck.

Until either happens: no virtualization, no memoization beyond the `$derived`
usage already specified throughout this directory, no premature optimization.
