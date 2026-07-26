# State Ownership: Singleton Module vs. Svelte Context

## Status

**Deferred.** This document exists so the trade-off is written down once and
referenced wherever it comes up (currently [command-history.md](./command-history.md#state-ownership)
and [ribbon.md](./ribbon.md#state-ownership)), rather than re-litigated per
spec. No decision is needed until the trigger conditions below actually occur.

---

## The question

`store.svelte.ts` today is a **singleton module**: `export const store = createStore()`,
one instance for the whole app, imported directly wherever it's needed. The
alternative is Svelte 5's `createContext`: a provider component sets an
instance, descendants read it via a getter, no import of shared mutable state.

## Trade-offs

| | Singleton `.svelte.ts` module (current) | Svelte context (`createContext`) |
| --- | --- | --- |
| Setup cost | Zero — import and use anywhere | A provider at a common ancestor, plus every consumer calls the getter |
| Multiple independent instances | Not possible — one instance for the whole app | Natural — each provider subtree gets its own instance |
| SSR safety | Risk: mutating shared module state during server-side rendering leaks between requests (called out directly in SvelteKit's own state-management guidance) | Safe — context is scoped per component tree / request |
| Testability in isolation | Harder — state persists across test cases/Storybook stories unless manually reset between them | Easier — a fresh context per test or story |
| Prop drilling | Avoided (global import) | Avoided (that's what context is for) |
| Consistency with existing code | Matches `store.svelte.ts` exactly, zero migration | New pattern — would need to be introduced deliberately, not mixed ad hoc |

## Why this is deferred, not decided

Composer Studio is a client-only editor, not a multi-tenant SSR app — the SSR
leak risk in the table above doesn't currently apply. And the near-term scope
(see [README.md](./README.md#scope)) is a **single piano-roll timeline**: one
document, one editor instance on screen at a time. Under those conditions the
singleton pattern has no real downside and matches what's already there.

## Trigger conditions to revisit

Re-open this decision when either becomes true:

1. **Multiple independent editor instances on one page** — e.g. orchestration
   work introduces more than one timeline/track visible simultaneously, and
   they need separate undo histories, selections, or ribbon UI state rather
   than sharing one.
2. **Test/Storybook isolation pain** — singleton state bleeding between test
   cases or stories becomes a recurring source of flaky tests, rather than a
   theoretical concern.

Until then: keep using singleton `.svelte.ts` modules for `CommandHistory`,
ribbon UI state, and anything else this question comes up for.
