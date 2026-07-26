# Application Architecture Specification

## Overview

This answers "where does code live, and what's allowed to depend on what" —
a question every other spec in this directory has been quietly assuming an
answer to (the tonal.js adapter, the command registry's pure `run()`
functions, `.svelte.ts` modules behind a root context provider) without ever
stating the rule those choices have in common. It's a lightweight take on Clean Architecture's
**dependency rule** — business logic shouldn't depend on frameworks, and
should be trivially testable in isolation — expressed through Svelte's own
idioms (which *file type* something is) rather than importing Clean
Architecture's full vocabulary (Entities, Use Cases, Interface Adapters,
Frameworks & Drivers) or its heavier ceremony (repository interfaces, DTOs
crossing every boundary).

## Why not full Clean Architecture

Clean Architecture's ceremony earns its keep when infrastructure needs to be
swappable — multiple databases, multiple delivery mechanisms, a system big
enough that the UI framework might plausibly change under the business logic
someday. None of that is true here: one persistence mechanism (IndexedDB, per
[persistence.md](./persistence.md)), one UI framework (Svelte), a single
composer-studio-shaped domain, built by two people. Full interface-based
dependency inversion for every boundary would mean real boilerplate
(interfaces + implementations + wiring) for a flexibility this project isn't
going to use. What's worth keeping is just the dependency
rule itself, because it's also exactly what makes code cheaply testable —
and that's a real, current requirement, not a hypothetical one
([testing-strategy.md](./testing-strategy.md)'s 80% target is scoped to
precisely the code this document calls "domain," below).

There's also a naming collision worth avoiding: SvelteKit already uses
"adapter" for a specific concept (`adapter-auto`, `adapter-static`, ...).
Reusing "Interface Adapters" from Clean Architecture on top of that would
make this project's own vocabulary ambiguous to anyone who knows SvelteKit
but not Clean Architecture — a real cost for a two-person project where the
second person shouldn't have to learn a separate architectural pattern
language on top of the framework's own.

---

## Four layers, named the Svelte-idiomatic way

| Layer | File type | Contains | May import |
| --- | --- | --- | --- |
| **Domain** | plain `.ts`, zero Svelte/DOM/browser-API imports | Types (`Note`, `ScaleEvent`, `ChordEvent`, `Layer`, ...), the tonal.js adapter, transform/generator `run()`/`isApplicable()`, timeline event resolution, editing invariants (clamp/snap/overlap) | Nothing in this app; may depend on a well-chosen external library (tonal.js) fully contained within its own adapter |
| **Application state** | `.svelte.ts` modules instantiated behind a root-provided Svelte context (per [state-ownership.md](./state-ownership.md)) | `store.svelte.ts`, selection state, `CommandHistory`, ribbon UI state | Domain, Infrastructure adapters |
| **Infrastructure adapters** | plain `.ts`, each wraps one external/browser API | `audio.ts`/the Tone.js wrapper, `midi-export.ts`, the IndexedDB persistence module | Domain only |
| **UI** | `.svelte` components | Everything currently in `src/lib/piano-roll/*.svelte`, the ribbon, drawers | Application state only |

### The rule, stated once

```
UI  →  Application state  →  { Domain, Infrastructure adapters }
```

Arrows point toward what a layer is *allowed to import*. Domain imports
nothing from this app — it's pure logic and data. Infrastructure adapters
import Domain types (they read/write `Note[]`, `ProjectFile`, ...) but never
Application state or UI: `persistence.ts` is handed a snapshot and hands one
back, it doesn't reach into `store.svelte.ts` itself. UI components never
import `tonal`, `Tone`, or IndexedDB directly — only the `.svelte.ts` layer
does that.

This is exactly Clean Architecture's dependency rule, just with four layers
instead of Uncle Bob's four rings, and named after Svelte file conventions
instead of Entities/Use-Cases/Adapters/Frameworks.

---

## tonal.js as domain value objects — answering directly

Yes, and it's a good fit: tonal.js already returns plain, effectively-
immutable data (`Scale.get(...)`, `Chord.get(...)` return plain objects, not
classes with hidden mutable state) — exactly the value-object modeling Clean
Architecture recommends for its Entities. The adapter module doesn't need to
fight that by wrapping every tonal call in a bespoke class.

The boundary that matters, already decided in
[libraries.md](./libraries.md#recommendation-wrap-it-dont-spray-it): tonal's
own shapes may be used freely *inside* the adapter module
(`src/lib/music-theory/`), but the functions the rest of the app calls
(`pitchClassesForScale`, `pitchClassesForChord`, ...) return **this app's own
plain shapes** (`Set<number>` pitch classes, not tonal's `Note`/`Scale`
objects). Nothing outside that one folder imports a `tonal` package directly.
That's the whole rule — this document just names it as the Domain/
external-library boundary rather than a one-off library recommendation.

---

## This was already the plan — now it's explicit

Several specs already assumed this layering without naming it:

- [libraries.md](./libraries.md)'s "wrap it, don't spray it" **is** the
  Domain/external-library boundary defined above.
- [transformations.md](./transformations.md)'s `CommandDescriptor.run()` —
  a pure function of `(CommandContext, params) → { notes, label }` — is
  already Domain-shaped; it doesn't touch `$state` or the DOM.
- [command-history.md](./command-history.md)'s `DocumentSnapshot` and
  `CommandHistory` class belong in Application state — they hold `$state`
  and orchestrate calls into Domain functions.
- [testing-strategy.md](./testing-strategy.md)'s 80%-coverage target is
  scoped to exactly the Domain layer defined here — not a coincidence: code
  with zero framework dependency is the code that's cheapest to test
  exhaustively, so the architecture boundary and the coverage boundary
  should be, and are, the same boundary.

---

## Folder layout is a nice-to-have, not a blocker

The table above describes logical layers, not a mandated folder tree.
`src/lib/piano-roll/` currently mixes `types.ts` (Domain), `store.svelte.ts`
(Application state), `audio.ts`/`midi-export.ts` (Infrastructure adapters),
and `.svelte` files (UI) in one flat directory — that's fine. The dependency
rule can be followed today under the current layout purely by discipline
about which files import what; it doesn't require a big-bang restructure of
already-working files. Reorganizing into by-layer folders
(`src/lib/domain/`, `src/lib/state/`, `src/lib/infrastructure/`) is worth
doing opportunistically as new Domain modules land — the tonal.js adapter
and the command registry are the first real candidates, per
[roadmap.md](./roadmap.md)'s Phase 2 — rather than moving existing files
just to match a diagram.
