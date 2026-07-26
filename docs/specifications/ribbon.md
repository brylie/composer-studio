# Ribbon Specification

## Overview

A WaveLab/Office-style ribbon is the primary way to reach the growing catalog
of transform and generate commands from [transformations.md](./transformations.md),
without requiring a menu-diving UX for commands that should be one click away.
It must work identically in spirit — commands grouped by intent, discoverable,
extensible — across phone, tablet, and desktop, which means the _layout_
adapts far more than the _data_ does.

---

## Top bar

Above everything else, an app-chrome bar that's stable regardless of which
ribbon tab is active or whether the ribbon is even open:

| Control               | Behaviour                                                                                                                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Back                  | Leaves the editor (route navigation, not an editor command)                                                                                                                                                                                                                          |
| Title / subtitle      | Track/project title; subtitle shows tempo + current snap division at a glance                                                                                                                                                                                                        |
| Preview toggle        | Hides editing chrome (ribbon, quick access bar) for an unobstructed playback view — a "performance mode," distinct from the [live-preview-while-adjusting-params](./transformations.md#live-preview--left-open) idea, which is about a single command's parameters, not the whole UI |
| Tools (ribbon) toggle | Shows/hides the tabbed ribbon — the mobile default is hidden, per Responsive behavior above                                                                                                                                                                                          |
| Sound drawer button   | Opens the [Sound drawer](./piano-roll.md#synth-panel--responsive-sound-drawer)                                                                                                                                                                                                       |

This sits above the Quick Access Bar, not in place of it — Top bar is
app-level chrome (navigation, view toggles), Quick Access Bar is
editing-transport chrome (play, undo, snap). Conflating the two would make
the always-visible-on-mobile row too crowded.

---

## Data structure

Three levels, matching the Office ribbon model: **Tab → Group → Command**. Tabs
and groups are presentation-only groupings over the command registry; they
don't duplicate command logic.

```typescript
interface RibbonGroup {
  id: string;
  labelKey: string; // Paraglide message key
  commandIds: string[]; // references into commandRegistry, see transformations.md
}

interface RibbonTab {
  id: string;
  labelKey: string;
  groups: RibbonGroup[];
}

const ribbonTabs: RibbonTab[] = [
  {
    id: 'transform',
    labelKey: 'ribbon_tab_transform',
    groups: [
      {
        id: 'pitch',
        labelKey: 'ribbon_group_pitch',
        commandIds: ['transpose', 'invert', 'mode-shift'],
      },
      {
        id: 'time',
        labelKey: 'ribbon_group_time',
        commandIds: ['retrograde', 'augmentation', 'diminution', 'metric-modulation'],
      },
      {
        id: 'structure',
        labelKey: 'ribbon_group_structure',
        commandIds: [
          'fragmentation',
          'truncation',
          'expansion',
          'permutation',
          'duplicate-selection',
        ],
      },
      {
        id: 'harmony',
        labelKey: 'ribbon_group_harmony',
        commandIds: ['reharmonization', 'voice-leading-adapt'],
      },
      { id: 'humanize', labelKey: 'ribbon_group_humanize', commandIds: ['jitter'] },
    ],
  },
  {
    id: 'generate',
    labelKey: 'ribbon_tab_generate',
    groups: [
      {
        id: 'patterns',
        labelKey: 'ribbon_group_patterns',
        commandIds: ['arpeggiate', 'euclidean-rhythm'],
      },
      {
        id: 'motif',
        labelKey: 'ribbon_group_motif',
        commandIds: ['motif-generate', 'ostinato-generate'],
      },
      { id: 'harmony', labelKey: 'ribbon_group_generate_harmony', commandIds: ['generate-chords'] },
    ],
  },
  {
    id: 'export',
    labelKey: 'ribbon_tab_export',
    groups: [
      {
        id: 'file',
        labelKey: 'ribbon_group_file',
        commandIds: ['export-midi', 'export-project', 'import-project'],
      },
    ],
  },
];
```

Rendering iterates this with keyed `{#each}` blocks (`{#each tab.groups as group (group.id)}`)
per Svelte best practice — never index-keyed, since reordering tabs/groups
later must not remount unrelated DOM.

### Quick Access Bar stays separate

`Toolbar.svelte`'s transport controls, snap grid, and loop toggle are **not**
folded into the tabbed ribbon — they're always-visible, not contextual, which
is exactly what an Office-style Quick Access bar is for. The ribbon spec
extends `Toolbar.svelte` into that role rather than replacing it, adding the
grid-mode and clipboard controls from [selection.md](./selection.md):

| Group     | Controls                                                                                                       |
| --------- | -------------------------------------------------------------------------------------------------------------- |
| Transport | Play/Stop, Rewind, Loop toggle                                                                                 |
| Snap      | `1 / 1/2 / 1/4 / 1/8 / 1/16`                                                                                   |
| Grid mode | Select-mode toggle (`'draw' \| 'select'`, per [selection.md](./selection.md#mode-based-interaction-semantics)) |
| Clipboard | Copy, Paste, Clear                                                                                             |
| History   | Undo, Redo                                                                                                     |

It stays pinned above (or beside, on mobile) the tabbed ribbon. On mobile the
bar itself may need its own horizontal scroll under heavy crowding — same
overflow treatment as the ribbon groups below.

---

## Responsive behavior

| Breakpoint          | Ribbon                                                                                                                 | Quick Access Bar                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Desktop (≥1024px)   | Full tabs + groups, icon+label buttons, always visible                                                                 | Always visible                               |
| Tablet (600–1024px) | Icon-only buttons with tooltips; groups compress, no group label row                                                   | Always visible                               |
| Mobile (<600px)     | Collapsed by default behind a toggle; opens as an overlay/bottom sheet; tabs become a horizontally scrollable pill row | Minimal: transport, undo/redo, ribbon toggle |

### Overflow: horizontal scroll, not truncation

When a group's commands don't fit — narrow tablet, a group that grows over
time — the group's command row becomes an `overflow-x: auto` scroll container
with `scroll-snap-type: x proximity` for touch. No commands are hidden behind
a "+N more" affordance; everything stays reachable by scrolling, and unlike a
hard cutoff this degrades gracefully as more commands are registered.

The **overflow indicator** is a CSS mask/gradient fade on whichever edge still
has scrollable content, computed from `scrollWidth > clientWidth` and current
`scrollLeft` (an `{@attach}` on the scroll container is the idiomatic way to
wire this up — it runs once on mount and can register a `scroll` listener via
`on(element, 'scroll', ...)` from `svelte/events`, cleaning up on teardown).
No numeric badge — the fade alone signals "more here" without adding visual
noise to every group.

---

## Parameter drawer

Commands with `params` (see [transformations.md](./transformations.md#command-descriptor))
render through one shared form component driven by the `ParamField[]` schema —
not a bespoke component per command:

```svelte
<!-- CommandParamsForm.svelte — sketch -->
{#each command.params as field (field.key)}
  {#if field.type === 'number' || field.type === 'range'}
    <input
      type={field.type === 'range' ? 'range' : 'number'}
      bind:value={values[field.key]}
      min={field.min}
      max={field.max}
      step={field.step}
    />
  {:else if field.type === 'select'}
    <select bind:value={values[field.key]}>
      {#each field.options as opt (opt.value)}<option value={opt.value}>{opt.label}</option>{/each}
    </select>
  {:else if field.type === 'boolean'}
    <input type="checkbox" bind:checked={values[field.key]} />
  {/if}
{/each}
```

`CommandParamsForm` is passed as content into the shared
[overlay shell](./overlay-shells.md) (bottom sheet on mobile, side drawer on
tablet/desktop) — the ribbon isn't the shell's only consumer, so the shell
mechanics (focus trap, dismiss, responsive shell selection) live there rather
than here. This section only owns the form itself.

---

## Keyboard shortcuts

Registered in exactly one place — a single `<svelte:window onkeydown={...}>`
at the app root (per Svelte guidance: prefer `<svelte:window>` over an
`onMount`/`$effect` `addEventListener`), matching against the registry's
`shortcut` field and calling `event.preventDefault()` only for the specific
combo matched, never broadly.

Before assigning a shortcut to a command, check it against a maintained table
of reserved browser/OS bindings (`Ctrl/Cmd+W`, `Ctrl/Cmd+T`, `Ctrl/Cmd+N`,
`Cmd+Q`, `Ctrl+Tab`, browser find `Ctrl/Cmd+F`, etc.) — those are never
eligible, regardless of how convenient the mnemonic is. User-remappable
shortcuts are future work, not v1.

---

## Discoverability

The ribbon's Quick Access bar carries a search affordance (icon + `Ctrl/Cmd+K`)
that opens the [command palette](./command-palette.md) — same registry, no
duplicated command data.

---

## i18n

Every visible string — tab labels, group labels, command labels, tooltips,
parameter field labels — is a Paraglide message key (`labelKey`/`descriptionKey`
on the descriptors above), consistent with the project's existing `paraglide`
setup. No hardcoded UI strings in ribbon components. Locales with longer
translated labels must not break layout — icon-only fallback (already the
tablet default) covers this rather than truncating text mid-word.

---

## Accessibility

See [accessibility.md](./accessibility.md) for the full cross-cutting spec;
ribbon-specific requirements are `toolbar`/`tablist`+`tab`/`tabpanel` ARIA
roles, roving `tabindex` within each group, and `aria-label` on every
icon-only button.

---

## State ownership

Ribbon UI state (active tab, mobile collapsed/expanded, drawer open) is
presentation-only and distinct from document state (`store.svelte.ts`). It's
created inside the same root context provider as the rest of Application
state and read via a getter, not a bare module singleton — see
[state-ownership.md](./state-ownership.md) for the root-provided-context
pattern this follows.

---

## Future Work

- User-customizable ribbon (pin/reorder favorite commands) — genuinely an
  Office-ribbon feature, but not needed until the catalog is large enough to
  make default layout inconvenient
- Recently-used commands surfaced at the top of a tab
