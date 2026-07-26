<script lang="ts">
  import type { Snippet } from 'svelte';
  import { provideEditorState } from './context.svelte.js';

  provideEditorState();

  let { children }: { children: Snippet } = $props();
</script>

{@render children()}
