import type { Locator, Page } from '@playwright/test';

// Shared helpers for the scale/chord/labels lane e2e suites (tracks.md).
// Not itself a *.e2e.ts file, so Playwright's testMatch doesn't pick it up
// as a test — plain support code the three lane suites import.

/** Returns the locator's bounding box, throwing if the element isn't rendered. */
export async function requireBoundingBox(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Expected element to have a bounding box');
  return box;
}

/**
 * Scopes to a single lane's `.lane-track` element by its accessible name
 * (`"{label} track: ..."`, set by EventTrackLane.svelte/ArrangerLane.svelte)
 * — all five lanes (Arranger/Time Sig/Scale/Chord/Labels) share the
 * `.lane-track` class, so an unscoped `page.locator('.lane-track')` is
 * ambiguous (Playwright strict mode) once more than one lane exists on the
 * page.
 */
export function laneTrack(
  page: Page,
  label: 'Arranger' | 'Time Sig' | 'Scale' | 'Chord' | 'Labels',
): Locator {
  return page.getByRole('group', { name: new RegExp(`^${label} track:`) });
}
