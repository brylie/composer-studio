# Overlay Shells: Bottom Sheet / Side Drawer

## Overview

Decomposed out of [ribbon.md](./ribbon.md), which originally specified this
as "the parameter drawer" — but by the time [editing-model.md](./editing-model.md)'s
note inspector and [piano-roll.md](./piano-roll.md)'s Sound drawer both
needed the same responsive shell, it stopped being a ribbon-specific concern.
This is now the one place that owns the mobile-bottom-sheet /
desktop-side-drawer pattern; each consumer below supplies its own content,
not its own shell.

## Known consumers

| Consumer                | Content                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ribbon parameter drawer | `CommandParamsForm`, schema-driven from a command's `ParamField[]` — see [transformations.md](./transformations.md#command-descriptor) and [ribbon.md](./ribbon.md#parameter-drawer) |
| Sound drawer            | Instrument/preset/envelope/filter controls — see [piano-roll.md](./piano-roll.md#synth-panel--responsive-sound-drawer)                                                               |
| Note inspector          | Pitch/start/duration/velocity fields — see [editing-model.md](./editing-model.md#note-inspector-precise-numeric-entry)                                                               |

Any future overlay with the same "small form, dismissible, device-dependent
presentation" shape should reuse this rather than growing a fourth bespoke
implementation.

---

## Shell contract

```svelte
{#snippet content()}
  <!-- consumer-supplied markup -->
{/snippet}

{#if isMobile}
  <BottomSheet onclose={cancel}>{@render content()}</BottomSheet>
{:else}
  <SideDrawer onclose={cancel}>{@render content()}</SideDrawer>
{/if}
```

- **`isMobile`**: a `MediaQuery` instance from `svelte/reactivity`
  (`new MediaQuery('max-width: 599px')`, matching
  [ribbon.md](./ribbon.md#responsive-behavior)'s mobile breakpoint) — reactive,
  no manual resize-listener wiring needed.
- **BottomSheet** (mobile): ~60–80% viewport height, slides up from the
  bottom, drag-to-dismiss.
- **SideDrawer** (tablet/desktop): ~320–380px wide, right-aligned, positioned
  so the note grid stays visible behind it (relevant if/when the transform
  live-preview idea in [transformations.md](./transformations.md#live-preview--left-open)
  is built).
- Content is passed as a snippet, not duplicated per shell — one form
  definition, two presentations.

## Focus management

Both shells trap focus while open and restore it to whichever control
invoked them on close (`Escape` or the explicit close action) — see
[accessibility.md](./accessibility.md#focus-management) for the full
requirement. This applies identically regardless of which of the three
consumers above opened the shell; there's exactly one focus-trap
implementation to get right, not three.
