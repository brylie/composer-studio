<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import PianoRoll from '$lib/piano-roll/PianoRoll.svelte';
</script>

<svelte:head>
	<title>{m.piano_roll_title()}</title>
</svelte:head>

<PianoRoll />
