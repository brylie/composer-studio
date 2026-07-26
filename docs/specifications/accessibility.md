# Accessibility Specification

> **Living document.** This is the cross-cutting standard every other spec in
> this directory references rather than restates. Update it as each feature
> above is implemented and accessibility gaps are found — it should never be
> treated as finished.

## Baseline

Target WCAG 2.1 AA. `@storybook/addon-a11y` is already a project dependency —
treat it as the enforcement mechanism (run per component in Storybook, not
just checked manually) rather than an unused add-on.

---

## Ribbon

- `toolbar` / `tablist` + `tab` + `tabpanel` ARIA roles for the tab/group
  structure ([ribbon.md](./ribbon.md#data-structure)).
- Roving `tabindex` within each group — one tab-stop per group, arrow keys
  move focus between commands inside it, matching the standard toolbar
  keyboard pattern.
- Every icon-only button (tablet/mobile default, per
  [ribbon.md](./ribbon.md#responsive-behavior)) requires an `aria-label`
  sourced from the same Paraglide key as its tooltip — never a bare icon with
  no accessible name.

## Piano roll / note grid

- Full parity with mouse/touch editing via keyboard is aspirational, not a v1
  requirement — say so explicitly rather than silently under-delivering. The
  realistic v1 baseline is mouse/touch-primary editing.
- At minimum, v1 should support: keyboard focus into the grid, arrow keys
  moving a selection cursor, Enter/Space to select/create at the cursor, and
  Delete to remove — enough for a keyboard user to be functional even if not
  as fast as a mouse user.
- Scale-degree highlighting ([tracks.md](./tracks.md#context-aware-highlighting))
  must not rely on color alone — an outline/shape difference (already the
  stated design) satisfies this, but verify contrast ratios in both light and
  dark themes once implemented.

## Focus management

Applies to every dialog-like overlay: the ribbon's parameter drawer, the
Sound drawer, the note inspector, and the (later) command palette.

- All are dialog-like overlays and must trap focus while open and
  restore focus to the invoking control on close — the same pattern
  SvelteKit's own focus-after-navigation handling models, just triggered by
  an overlay open/close instead of a route change.
- `Escape` closes and restores focus; this must work identically across the
  bottom sheet (mobile), side drawer (desktop), and command palette so users
  don't have to learn three different dismissal behaviors.

## Motion

- Respect `prefers-reduced-motion` for drawer/sheet enter-exit transitions and
  for playhead animation smoothing — reduce to instant or minimal-motion
  equivalents rather than disabling the feature outright.

## Screen reader announcements

- Command execution should announce a result summary (e.g. "Transposed 4
  notes up 2 semitones") via a visually-hidden `aria-live="polite"` region.
  Because every [command descriptor](./transformations.md#command-descriptor)
  already produces a `label` for the undo stack, the same string can drive
  this announcement — no separate per-command announcement text to maintain.

## i18n intersects accessibility

- `<html lang>` must reflect the active Paraglide locale (SvelteKit's own
  accessibility guidance calls this out for the same reason: assistive tech
  needs the correct pronunciation).
- Ribbon layout must tolerate longer translated labels without breaking —
  covered by the icon-only fallback in [ribbon.md](./ribbon.md#i18n).

---

## Process

- New components get an a11y pass in Storybook (via the a11y addon) before
  merging, not after — the target once
  [testing-strategy.md](./testing-strategy.md#storybook-component-coverage-accessibility-as-a-gate)'s
  CI gate is actually wired up (explicitly **not** the case yet, per that
  document's own Status section); until then this is a manual practice to
  follow, not an enforced one.
- When a spec above makes an accessibility trade-off (e.g. "full keyboard
  parity is aspirational"), that trade-off is recorded here, not silently
  assumed.
