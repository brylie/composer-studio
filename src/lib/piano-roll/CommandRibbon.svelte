<script lang="ts">
  import { MediaQuery } from 'svelte/reactivity';
  import { getEditorState } from './context.svelte.js';
  import OverlayShell from './OverlayShell.svelte';
  import RibbonPanel from './RibbonPanel.svelte';

  const { ribbonUi } = getEditorState();

  // Matches ribbon.md's mobile breakpoint: collapsed behind a toggle that
  // opens the ribbon as a bottom sheet, vs. always-visible inline on
  // tablet/desktop.
  const isMobile = new MediaQuery('max-width: 599px');
</script>

{#if isMobile.current}
  <OverlayShell
    open={ribbonUi.ribbonOpen}
    title="Commands"
    onclose={() => (ribbonUi.ribbonOpen = false)}
  >
    <RibbonPanel sheet />
  </OverlayShell>
{:else if ribbonUi.ribbonOpen}
  <RibbonPanel />
{/if}
