# Command Palette Specification

## Status

**Future milestone — not part of the initial development pass.** This spec
exists so the [command registry](./transformations.md) is designed to support
a palette from day one, rather than retrofitting search/keywords onto command
descriptors later.

---

## Overview

A searchable, keyboard-first overlay (`Ctrl/Cmd+K`, and a search icon in the
ribbon's Quick Access bar) over the same `commandRegistry` the ribbon renders
— the payoff of the registry being declarative and centralized
([transformations.md](./transformations.md#the-registry-itself)) is that the
palette requires no separate command data, only a different renderer over it.

---

## Behavior

- **Search**: fuzzy match against `labelKey` (resolved string), `descriptionKey`,
  `category`, and `keywords` (the field reserved for this in
  `CommandDescriptor`).
- **Applicability**: inapplicable commands (per `isApplicable(ctx)`) are shown
  disabled with a reason tooltip, not hidden — the palette doubles as a
  discovery/learning surface for what the tool can do, which a hide-if-disabled
  approach would undermine.
- **Keyboard**: arrow keys move selection, Enter invokes, Escape closes.
  Parameterized commands invoked from the palette open the same
  [parameter drawer](./ribbon.md#parameter-drawer) the ribbon uses.
- **Focus**: same focus-trap-and-restore pattern as the parameter drawer — see
  [accessibility.md](./accessibility.md#focus-management).

---

## Non-transform commands

The palette is also the natural home for navigation/view commands that don't
belong in the Transform/Generate/Export ribbon tabs (e.g. "Toggle velocity
lane", "Expand to fullscreen") — these are registry entries with
`category: 'view'` or `'transport'`, same descriptor shape, just not surfaced
in a ribbon tab.

---

## Explicitly deferred

- Recently-used / frequency-ranked ordering
- Multi-step commands (palette entries that chain into a follow-up prompt)
