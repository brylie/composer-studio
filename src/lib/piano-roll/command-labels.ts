// labelKey isn't wired to Paraglide messages yet (see commands/types.ts) — a
// small display map keeps the ribbon and params drawer readable in the
// meantime. Shared (rather than declared per-component) so RibbonPanel and
// CommandRibbon show identical command titles.
export const COMMAND_LABELS: Record<string, string> = {
  transpose: 'Transpose',
  retrograde: 'Retrograde',
  invert: 'Invert',
  augmentation: 'Augmentation',
  diminution: 'Diminution',
  permutation: 'Permutation',
  jitter: 'Jitter',
  'generate-chords': 'Generate Chords',
};
