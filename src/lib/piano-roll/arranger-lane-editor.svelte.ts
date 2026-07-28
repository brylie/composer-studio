// Application state — "which section's rename/delete editor is open" state
// for ArrangerLane (tracks.md#arranger-track-placeholder). Distinct from
// lane-editor.svelte.ts's createLaneEditor: that controller always opens on
// tap, including for a brand-new marker, since a point event (scale/chord/
// label) has no meaning until a value is chosen. A section already has a
// sensible default the moment it exists — ArrangerLane creates it directly
// via store.addArrangerSection on an empty-space tap (tracks.md's "add by
// tapping empty space") — so this controller only ever targets an *existing*
// section, opened by tapping that section's block (tracks.md's "rename/
// delete via tap").

import type { ArrangerSection } from './arranger.js';

export interface ArrangerLaneEditorController {
  readonly target: ArrangerSection | null;
  /** Opens the rename/delete editor for an existing section (e.g. a tap-without-drag on its block). */
  openFor: (section: ArrangerSection) => void;
  save: (label: string, color: string) => void;
  delete: () => void;
  close: () => void;
}

/**
 * Every method below is an arrow function (not object-literal method
 * shorthand), same reasoning as lane-editor.svelte.ts's createLaneEditor:
 * PianoRoll.svelte binds these directly as component props, and an arrow
 * function can never have an unbound-`this` problem.
 */
export function createArrangerLaneEditor(
  updateSection: (id: string, updates: { label: string; color: string }) => void,
  removeSection: (id: string) => void,
): ArrangerLaneEditorController {
  let target: ArrangerSection | null = $state(null);

  return {
    get target() {
      return target;
    },
    openFor: (section: ArrangerSection) => {
      target = section;
    },
    save: (label: string, color: string) => {
      if (!target) return;
      updateSection(target.id, { label, color });
      target = null;
    },
    delete: () => {
      if (!target) return;
      removeSection(target.id);
      target = null;
    },
    close: () => {
      target = null;
    },
  };
}
