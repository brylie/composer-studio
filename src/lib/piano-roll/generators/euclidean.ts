// Domain layer — shared Euclidean/"maximally even" onset pattern
// (generators.md §4.8, §9.1, §18 Phase D).
//
// Rhythmic scheduling is Composer Studio's own responsibility, not Tonal's
// (generators.md §3: "density and rhythmic scheduling"): distributing
// `pulses` onsets as evenly as possible across `steps` is a scheduling
// algorithm, not a music-theory vocabulary Tonal exposes a primitive for, so
// it's implemented here rather than through @tonaljs/rhythm-pattern
// (generators.md §3.1 rule 4). Shared by euclidean-source (a rhythm source)
// and euclidean-gate (an event slicer) — generators.md §4.8: "share the
// Euclidean pulse algorithm while exposing separate operator descriptors."

/**
 * A boolean onset pattern of length `steps` with `pulses` onsets spread as
 * evenly as possible (a Bresenham-style even distribution, closely matching
 * the classic Euclidean/Bjorklund rhythm for most step/pulse combinations),
 * rotated left by `rotation` steps. `pulses` is clamped to `[0, steps]`, so
 * the result always contains exactly `clamp(pulses, 0, steps)` onsets — the
 * property tests in generators.md §17 rely on this invariant.
 */
export function euclideanPattern(steps: number, pulses: number, rotation: number): boolean[] {
  const stepCount = Math.max(0, Math.floor(steps));
  if (stepCount === 0) return [];
  const pulseCount = Math.max(0, Math.min(stepCount, Math.floor(pulses)));

  const base: boolean[] = [];
  let bucket = 0;
  for (let i = 0; i < stepCount; i++) {
    bucket += pulseCount;
    if (bucket >= stepCount) {
      bucket -= stepCount;
      base.push(true);
    } else {
      base.push(false);
    }
  }

  const shift = ((Math.floor(rotation) % stepCount) + stepCount) % stepCount;
  if (shift === 0) return base;
  return base.map((_, i) => base[(i + shift) % stepCount]);
}
