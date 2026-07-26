# State Ownership: Root-Provided Svelte Context

## Status

**Decided.** Application state (`store.svelte.ts`, selection, `CommandHistory`,
ribbon UI state) is created inside a provider component near the app root
and read via `getContext`, instead of being a bare module-level singleton.
Referenced from [command-history.md](./command-history.md#state-ownership),
[ribbon.md](./ribbon.md#state-ownership), and
[architecture.md](./architecture.md#four-layers-named-the-svelte-idiomatic-way)'s
Application state layer.

---

## The question this replaces

`store.svelte.ts` today is a **singleton module**: `export const store = createStore()`,
one instance for the whole app, imported directly wherever it's needed. Svelte
5's `createContext` was the named alternative: a provider component sets an
instance, descendants read it via a getter, no shared mutable module state.

Framed as an either/or, this was worth deferring: the near-term scope is one
document, one editor instance on screen, and a bare singleton has zero setup
cost under those conditions. But it isn't really either/or — a **root-level
provider with the option to nest a second one** gets the singleton's
zero-friction default _and_ keeps a subtree free to opt into its own
isolated instance later, for about the same implementation cost as adopting
context at all. That's the resolution below.

## The pattern

One provider component near the app root (e.g. `+layout.svelte`) creates the
real instances and calls `setContext` for each — `store`, selection state,
`CommandHistory`, ribbon UI state:

```svelte
<!-- +layout.svelte -->
<script lang="ts">
  import { provideEditorState } from '$lib/piano-roll/context.svelte';
  provideEditorState(); // calls setContext(...) once, during init
  let { children } = $props();
</script>

{@render children()}
```

Every consumer calls a getter instead of importing the module directly:

```typescript
// context.svelte.ts
import { getContext, setContext } from 'svelte';

const KEY = Symbol('editor-state');

export function provideEditorState() {
  const state = { store: createStore(), history: new CommandHistory() /* ... */ };
  setContext(KEY, state);
  return state;
}

export function getEditorState() {
  const state = getContext(KEY);
  if (!state) throw new Error('No EditorState provider found in ancestor tree');
  return state; // throws clearly if no provider is an ancestor
}
```

For the single-timeline v1 scope, this behaves exactly like today's
singleton: one provider, set once, read everywhere below it. The difference
only shows up when something needs to _not_ share that instance — a
component wraps its own subtree in a second `provideEditorState()` call,
and everything inside that subtree reads the nested instance instead,
automatically, because `getContext` always resolves to the nearest ancestor
provider. No consumer code has to know which case it's in.

### Svelte's one hard constraint

`setContext` must run during component initialization — the top level of a
component's `<script>`, not inside an event handler, `$effect`, or
conditionally. This is exactly what the pattern above already does (`+layout.svelte`
calls it unconditionally at the top), but it's worth naming because it's the
one way this pattern can be gotten wrong once a second, nested provider is
introduced later.

## Why this over a bare singleton, now that both cost about the same

The original trade-off table (kept below for reference) mostly measured
"context costs setup a singleton doesn't." A root-provided context pays that
setup cost once, up front, and gets every entry in the table's "context"
column for free from that point on — there's no cheaper way to keep the
option open:

|                                                            | Singleton `.svelte.ts` module                                           | Root-provided context (this decision)                                  |
| ---------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Cost for the current single-instance scope                 | Zero                                                                    | One provider component + a getter per consumer — small, one-time       |
| Multiple independent instances (separate documents, tests) | Not possible without a rewrite                                          | Nest a second provider — no rewrite of consumers                       |
| SSR safety                                                 | Risk: shared module state can leak across requests                      | Safe — scoped per component tree/request                               |
| Testability in isolation                                   | Harder — state persists across test cases/stories unless manually reset | Easier — wrap a test/story in its own provider for a fresh instance    |
| Consistency with existing code                             | Matches `store.svelte.ts` exactly                                       | New pattern, deliberately introduced once (this doc), not mixed ad hoc |

Composer Studio is still a client-only editor, not multi-tenant SSR, so the
SSR-leak risk isn't an active problem — but it isn't the deciding factor
either. The deciding factor is that paying the context-adoption cost once
already buys the multi-instance and test-isolation benefits, so there's no
reason to defer it behind a "trigger condition" that would just mean paying
the same migration cost later, under more time pressure, once one of those
needs actually shows up.

## What this replaces from the old deferred version

The previous version of this document deferred the decision behind two
trigger conditions — multiple simultaneous editor instances, and test/Storybook
isolation pain — with "multiple instances" originally imagined as the
mechanism for multi-instrument orchestration (one editor instance per
instrument/track). [layers.md](./layers.md) resolved that assumption away:
orchestration turned out to need one document with instruments as layers,
not multiple documents, so it was never actually going to be this
mechanism's job. What nesting a second provider is still genuinely for:

1. **Genuinely separate documents** — e.g. two unrelated compositions open
   at once, if that's ever wanted — not per-instrument editing within one
   composition, which stays on a single document/selection/undo-history per
   [layers.md](./layers.md).
2. **Test/Storybook isolation** — a test or story wraps its subject in its
   own `provideEditorState()` call, getting a fresh instance without manual
   reset logic. This is the trigger condition that still actually matters
   day-to-day.

## Migration cost, named honestly

This is not free relative to _today's_ code: `store.svelte.ts`, and the
selection/`CommandHistory`/ribbon-state modules specified elsewhere in this
directory, currently assume "import the module" and would need to become
"call the getter inside component init" instead. That migration should
happen once, as part of [roadmap.md](./roadmap.md)'s Phase 1 (selection +
command-history) and the ribbon-state work in Phase 3 — the first points at
which these modules are actually being built out for real — rather than as a
separate retrofit pass after the fact.
