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

export const COMMAND_DESCRIPTIONS: Record<string, string> = {
  transpose: 'Shift pitch by semitones',
  retrograde: 'Reverse note order in time',
  invert: 'Mirror pitch around a center note',
  augmentation: 'Stretch note durations',
  diminution: 'Shrink note durations',
  permutation: 'Reorder selected notes',
  jitter: 'Randomize timing and pitch slightly',
  'generate-chords': 'Generate voice-led chords from the selection',
};

export const DISABLED_REASON_TEXT: Record<string, string> = {
  'commands.disabled.selectAtLeastOne': 'Select at least one note',
  'commands.disabled.selectAtLeastTwo': 'Select at least two notes',
};
