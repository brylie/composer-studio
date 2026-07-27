// Application state — presentation-only ribbon/overlay UI state, distinct from
// document state (store.svelte.ts). See state-ownership.md and ribbon.md#state-ownership.

export type RibbonTabId = 'transform' | 'generate';

export interface RibbonUiState {
  activeTab: RibbonTabId;
  ribbonOpen: boolean;
  paramsDrawerOpen: boolean;
  soundDrawerOpen: boolean;
  previewMode: boolean;
}

function prefersRibbonOpenByDefault(): boolean {
  if (typeof window === 'undefined') return true;
  return !window.matchMedia('(max-width: 599px)').matches;
}

export function createRibbonUiState(): RibbonUiState {
  let activeTab: RibbonTabId = $state('transform');
  let ribbonOpen = $state(prefersRibbonOpenByDefault());
  let paramsDrawerOpen = $state(false);
  let soundDrawerOpen = $state(false);
  let previewMode = $state(false);

  return {
    get activeTab() {
      return activeTab;
    },
    set activeTab(value) {
      activeTab = value;
    },
    get ribbonOpen() {
      return ribbonOpen;
    },
    set ribbonOpen(value) {
      ribbonOpen = value;
    },
    get paramsDrawerOpen() {
      return paramsDrawerOpen;
    },
    set paramsDrawerOpen(value) {
      paramsDrawerOpen = value;
    },
    get soundDrawerOpen() {
      return soundDrawerOpen;
    },
    set soundDrawerOpen(value) {
      soundDrawerOpen = value;
    },
    get previewMode() {
      return previewMode;
    },
    set previewMode(value) {
      previewMode = value;
    },
  };
}
