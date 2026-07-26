# Design Tokens

## Overview

Colors, spacing, and other visual constants used across the ribbon,
overlay-shells, piano roll, and tracks specs — currently referenced only
informally ("a colored section block," "highlighted loop band," "outlines"
for scale-degree indication). This pins those down as real tokens rather than
each component inventing its own values, using the project's existing stack
(Tailwind CSS v4) rather than introducing a separate design-tokens system.

## Where tokens live

The project already has one global stylesheet:
[`src/routes/layout.css`](../../src/routes/layout.css), imported once from
[`+layout.svelte`](../../src/routes/+layout.svelte). It currently contains
only `@import 'tailwindcss'`, the forms/typography plugins, and a couple of
hardcoded rules (`background: #1a1a2e` on `html, body`).

This project uses **Tailwind v4's CSS-first configuration** — there is no
`tailwind.config.js`. Tokens are declared with an `@theme` block directly in
CSS, which both defines a CSS custom property (`--color-...`, `--spacing-...`)
and generates the matching utility classes (`bg-...`, `p-...`) automatically.
That means writing tokens _is_ configuring Tailwind; there's no separate
token file to keep in sync with a config object.

Recommendation: split the token declarations out of `layout.css` into a
sibling `src/routes/theme.css`, imported first:

```css
/* theme.css */
@theme {
  --color-surface: #1a1a2e;
  --color-surface-raised: #232342;
  --color-accent: #7c5cff;
  /* ... */
}
```

```css
/* layout.css */
@import './theme.css';
@import 'tailwindcss';
@plugin '@tailwindcss/forms';
@plugin '@tailwindcss/typography';

html,
body {
  margin: 0;
  padding: 0;
  height: 100%;
  overflow: hidden;
  background: var(--color-surface);
}
```

Keeping tokens in their own file matters here specifically because several
of them (section colors, scale-degree highlight, loop band) are referenced
by name from other specs below — a dedicated file is a stable place to point
at, rather than a growing, undifferentiated `layout.css`.

## Token categories

Only the categories current specs actually need. Extend as new UI is built,
not speculatively ahead of it.

### Color

| Token                                                          | Used by                                                                                      | Notes                                                                                                                      |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `--color-surface`, `--color-surface-raised`                    | App background, ribbon/drawer panels                                                         | `--color-surface` already exists as a hardcoded hex; becomes a named token                                                 |
| `--color-accent`                                               | Primary actions, active tab indicator, playhead                                              | One accent, not a full brand palette — matches this project's scope                                                        |
| `--color-scale-degree`                                         | [tracks.md](./tracks.md#context-aware-highlighting) note-grid highlight for in-scale pitches | Outline/border color, not a fill — notes stay legible                                                                      |
| `--color-loop-band`                                            | [piano-roll.md](./piano-roll.md#ruler) loop region on the ruler                              | Semi-transparent, layered under the ruler's bar numbers                                                                    |
| `--color-section-{n}` (a small fixed palette, e.g. 6–8 colors) | [tracks.md](./tracks.md#arranger-track-placeholder) arranger section blocks                  | Sections cycle through this palette by creation order; not user-customizable in v1 — an open future enhancement, not a gap |
| `--color-danger`                                               | Delete/clear actions, destructive confirmation states                                        |                                                                                                                            |

### Spacing / sizing

Tailwind's default spacing scale (`--spacing`, a single base unit Tailwind
multiplies for `p-1`/`p-2`/etc.) covers general layout. Two music-specific
sizing tokens are worth naming explicitly because they're referenced by
piano-roll.md's zoom behavior and aren't just "spacing":

| Token                | Used by                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| `--piano-key-height` | Piano Keys column row height at 1x zoom — the unit note-grid row height derives from                            |
| `--ribbon-height`    | [ribbon.md](./ribbon.md) desktop ribbon height, needed by layout code that reserves space for it above the grid |

### Typography

No custom type scale beyond Tailwind's defaults is currently justified —
none of the specs so far call for anything beyond body text and a couple of
heading/label sizes already covered by Tailwind's `text-sm`/`text-base`/etc.
Revisit if a spec introduces a real typographic need (e.g. a monospace token
for beat/tick readouts).

## What's explicitly deferred

- **Dark/light theme switching.** Every spec so far assumes the single dark
  theme implied by the existing `#1a1a2e` background. Token-izing colors now
  (rather than leaving them as hardcoded hex) is what makes a future light
  theme possible, but building one isn't in scope until asked for.
- **User-customizable section colors** (mentioned above) — v1 ships a fixed
  palette cycled by creation order.
- **A formal icon set.** [ribbon.md](./ribbon.md) references icons per
  `RibbonGroup`/`CommandDescriptor` but doesn't name a specific icon library;
  left open until ribbon implementation actually needs to pick one.
