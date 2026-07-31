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
};

export const COMMAND_DESCRIPTIONS: Record<string, string> = {
  transpose: 'Shift pitch by semitones',
  retrograde: 'Reverse note order in time',
  invert: 'Mirror pitch around a center note',
  augmentation: 'Stretch note durations',
  diminution: 'Shrink note durations',
  permutation: 'Reorder selected notes',
  jitter: 'Randomize timing and pitch slightly',
};

export const DISABLED_REASON_TEXT: Record<string, string> = {
  'commands.disabled.selectAtLeastOne': 'Select at least one note',
  'commands.disabled.selectAtLeastTwo': 'Select at least two notes',
};

// Same not-yet-wired-to-Paraglide situation as COMMAND_LABELS above, for
// GeneratorDescriptor.labelKey/descriptionKey (generators.md §5, §7.4).
export const GENERATOR_LABELS: Record<string, string> = {
  'pulse-pattern': 'Pulse',
  'generate-chords': 'Chords',
  arpeggiate: 'Arpeggiate',
  'euclidean-rhythm': 'Euclidean',
  'ostinato-generate': 'Ostinato',
  'motif-generate': 'Motif',
};

export const GENERATOR_DESCRIPTIONS: Record<string, string> = {
  'pulse-pattern': 'A regular rhythmic pulse you can bound, voice, and vary',
  'generate-chords': 'Voice-led chords from the chord track or a selection',
  arpeggiate: 'A chord arpeggiated through a Euclidean rhythm gate',
  'euclidean-rhythm': 'An evenly-spread Euclidean onset pattern',
  'ostinato-generate': 'A repeating cell that can follow the scale or chord',
  'motif-generate': 'A short contoured melodic cell, repeated and varied',
};
