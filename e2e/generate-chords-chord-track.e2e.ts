import { expect, test } from '@playwright/test';
import { laneTrack } from './lane-helpers.js';

// Phase 7's generate-chords upgrade (transformations.md#generate-chords-is-the-priority-v1-case):
// source: 'chord-track' reads the chord track directly instead of inferring
// a chord from selected melody notes — this exercises that path end-to-end
// through the ribbon's params drawer, not just generate-chords.spec.ts's
// direct run() calls.

test.describe('generate-chords — chord-track source', () => {
  test('voices the chord track into new notes with no melody selected', async ({ page }) => {
    await page.goto('/');

    // Place a Cmaj7 marker on the chord lane at beat 0.
    await laneTrack(page, 'Chord').click({ position: { x: 0, y: 13 } });
    await page.locator('#chord-root').selectOption('0'); // C
    await page.locator('#chord-quality').selectOption('maj7');
    await page.getByRole('button', { name: 'Add marker' }).click();
    await expect(laneTrack(page, 'Chord').locator('.lane-marker')).toHaveCount(1);

    // No notes exist yet — generate-chords must add them, not require a selection.
    await expect(page.locator('.note')).toHaveCount(0);

    // Open the Generate tab and the generate-chords params drawer.
    await page.getByRole('tab', { name: 'Generate' }).click();
    await page.getByRole('button', { name: 'Generate Chords' }).click();
    await expect(page.locator('.overlay-title', { hasText: 'Generate Chords' })).toBeVisible();

    // Switch source to the chord track — targetRange defaults to beats 0..4,
    // which covers the marker just placed, so it's left untouched.
    await page.getByLabel('Source').selectOption('chord-track');
    await expect(page.getByLabel('Target range (beats)').first()).toBeVisible();

    await page.getByRole('button', { name: 'Apply' }).click();

    // Default voiceCount is 4 — expect exactly 4 newly voiced chord notes,
    // and the drawer closes on a successful run.
    await expect(page.locator('.overlay-title', { hasText: 'Generate Chords' })).toBeHidden();
    await expect(page.locator('.note')).toHaveCount(4);
  });
});
