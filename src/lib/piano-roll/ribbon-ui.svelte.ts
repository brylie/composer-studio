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

export function createRibbonUiState(): RibbonUiState {
  let activeTab: RibbonTabId = $state('transform');
  // Starts open on every render path (SSR and the client's first hydration
  // pass) to keep the initial markup identical; the client-only effect below
  // narrows it to the mobile default once `window` is available. $derived
  // (rather than $state) so the manual toggle button can still reassign it.
  let ribbonOpen = $derived(true);
  let paramsDrawerOpen = $state(false);
  let soundDrawerOpen = $state(false);
  let previewMode = $state(false);

  // $effect bodies never run during SSR, so `window` is safely available here.
  $effect(() => {
    ribbonOpen = !window.matchMedia('(max-width: 599px)').matches;
  });

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
