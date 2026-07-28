<script module lang="ts">
  type Shape =
    | { tag: 'path'; d: string; fill?: string }
    | { tag: 'line'; x1: number; y1: number; x2: number; y2: number }
    | { tag: 'circle'; cx: number; cy: number; r: number; fill?: string }
    | { tag: 'rect'; x: number; y: number; width: number; height: number; rx?: number };

  const ICONS: Record<string, Shape[]> = {
    // ── Command icons (keyed by CommandDescriptor.icon) ──
    'arrow-up-down': [
      { tag: 'line', x1: 6.5, y1: 1.5, x2: 6.5, y2: 11.5 },
      { tag: 'path', d: 'M4 4L6.5 1.5L9 4' },
      { tag: 'path', d: 'M4 9L6.5 11.5L9 9' },
    ],
    reverse: [
      { tag: 'path', d: 'M1.5 4H11.5' },
      { tag: 'path', d: 'M4 1.5L1.5 4L4 6.5' },
      { tag: 'path', d: 'M1.5 9H11.5' },
      { tag: 'path', d: 'M9 6.5L11.5 9L9 11.5' },
    ],
    'flip-vertical': [
      { tag: 'line', x1: 1, y1: 6.5, x2: 12, y2: 6.5 },
      { tag: 'path', d: 'M6.5 1.2L9 4.5H4Z', fill: 'currentColor' },
      { tag: 'path', d: 'M6.5 11.8L9 8.5H4Z', fill: 'currentColor' },
    ],
    'expand-horizontal': [
      { tag: 'line', x1: 2, y1: 6.5, x2: 11, y2: 6.5 },
      { tag: 'path', d: 'M4 4L1.5 6.5L4 9' },
      { tag: 'path', d: 'M9 4L11.5 6.5L9 9' },
    ],
    'compress-horizontal': [
      { tag: 'line', x1: 1.5, y1: 6.5, x2: 11.5, y2: 6.5 },
      { tag: 'path', d: 'M3 4L5.5 6.5L3 9' },
      { tag: 'path', d: 'M10 4L7.5 6.5L10 9' },
    ],
    // Each crossing arrow is one path: the shaft plus its arrowhead as a
    // second subpath, with the head's wings placed symmetrically around the
    // shaft's own reverse angle (not eyeballed) so it reads cleanly at 13px.
    shuffle: [
      { tag: 'path', d: 'M1.5 3L11 9M8.7 8.8L11 9L9.9 7' },
      { tag: 'path', d: 'M1.5 9L11 3M8.7 3.2L11 3L9.9 5' },
    ],
    // Keyed 'dice' to match jitter.ts's icon field, but drawn as an
    // irregular zigzag — a bolder, single-stroke read for "randomize" than
    // tiny filled pips, which blur out at this size.
    dice: [{ tag: 'path', d: 'M1.5 8L3.5 4L5.5 9.5L7.5 3L9.5 9L11.5 5' }],
    chord: [
      { tag: 'circle', cx: 4, cy: 9.5, r: 1.9, fill: 'currentColor' },
      { tag: 'circle', cx: 6.5, cy: 6.5, r: 1.9, fill: 'currentColor' },
      { tag: 'circle', cx: 9, cy: 3.5, r: 1.9, fill: 'currentColor' },
    ],

    // ── Chrome icons (top bar / drawers) ──
    back: [{ tag: 'path', d: 'M8.5 2L3.5 6.5L8.5 11' }],
    eye: [
      {
        tag: 'path',
        d: 'M1 6.5C1 6.5 3.5 2.5 6.5 2.5C9.5 2.5 12 6.5 12 6.5C12 6.5 9.5 10.5 6.5 10.5C3.5 10.5 1 6.5 1 6.5Z',
      },
      { tag: 'circle', cx: 6.5, cy: 6.5, r: 1.8 },
    ],
    tools: [
      { tag: 'rect', x: 1.5, y: 2, width: 10, height: 9, rx: 1.5 },
      { tag: 'line', x1: 1.5, y1: 5, x2: 11.5, y2: 5 },
    ],
    sound: [
      { tag: 'path', d: 'M1.5 5H4L7 2V11L4 8H1.5Z', fill: 'currentColor' },
      { tag: 'path', d: 'M9 4.5C10 5.5 10 7.5 9 8.5' },
    ],
    close: [
      { tag: 'line', x1: 2, y1: 2, x2: 11, y2: 11 },
      { tag: 'line', x1: 11, y1: 2, x2: 2, y2: 11 },
    ],
    export: [
      { tag: 'line', x1: 6.5, y1: 1, x2: 6.5, y2: 8 },
      { tag: 'path', d: 'M4 5.5L6.5 8L9 5.5' },
      { tag: 'path', d: 'M1.5 9V11.5H11.5V9' },
    ],
  };
</script>

<script lang="ts">
  interface Props {
    name: string;
    size?: number;
  }

  const { name, size = 13 }: Props = $props();
  const shapes = $derived(ICONS[name] ?? []);
</script>

<svg width={size} height={size} viewBox="0 0 13 13" aria-hidden="true" class="icon">
  {#each shapes as shape, i (i)}
    {#if shape.tag === 'path'}
      <path d={shape.d} fill={shape.fill ?? 'none'} />
    {:else if shape.tag === 'line'}
      <line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} />
    {:else if shape.tag === 'circle'}
      <circle cx={shape.cx} cy={shape.cy} r={shape.r} fill={shape.fill ?? 'none'} />
    {:else if shape.tag === 'rect'}
      <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx ?? 0} />
    {/if}
  {/each}
</svg>

<style>
  .icon {
    flex-shrink: 0;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
