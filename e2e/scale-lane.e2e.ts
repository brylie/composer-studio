import { expect, test } from '@playwright/test';
import { laneTrack, requireBoundingBox } from './lane-helpers.js';

// Phase 6 scale lane (tracks.md) — pointer-interaction coverage for the
// tap-vs-pan disambiguation and totalBeats boundary clamp, since neither is
// exercised by the store/domain unit tests (those only cover what happens
// once a beat value reaches the store, not how EventTrackLane derives it
// from raw pointer coordinates).

test.describe('Scale lane', () => {
  test('shows the default C major marker at beat 0', async ({ page }) => {
    await page.goto('/');
    const marker = laneTrack(page, 'Scale').locator('.lane-marker').first();
    await expect(marker).toBeVisible();
    await expect(marker).toHaveText('C major');
  });

  test('tapping empty lane space opens the scale marker editor', async ({ page }) => {
    await page.goto('/');
    await laneTrack(page, 'Scale').click({ position: { x: 300, y: 13 } });
    await expect(page.locator('.overlay-title', { hasText: 'Scale marker' })).toBeVisible();
  });

  test('a pan-like drag starting on empty lane space does not open the editor', async ({
    page,
  }) => {
    await page.goto('/');
    const box = await requireBoundingBox(laneTrack(page, 'Scale'));
    const y = box.y + box.height / 2;
    const startX = box.x + box.width / 2;

    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX + 30, y, { steps: 5 });
    await page.mouse.up();

    await expect(page.locator('.overlay-title', { hasText: 'Scale marker' })).toBeHidden();
  });

  test('a marker cannot be created at or beyond the lane totalBeats boundary', async ({ page }) => {
    await page.goto('/');
    await page.locator('.scroll-area').evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });

    const track = laneTrack(page, 'Scale');
    const box = await requireBoundingBox(track);

    // Click the very last pixel of the lane — its own totalBeats boundary.
    await track.click({ position: { x: box.width - 2, y: box.height / 2 } });

    const readout = page.locator('.beat-readout');
    await expect(readout).toBeVisible();
    const text = await readout.textContent();
    const beat = Number(text?.replace('Beat ', ''));
    expect(beat).toBeLessThan(64); // default totalBeats — the lane's own half-open upper bound
  });

  test('dragging the default marker past the left edge clamps to beat 0', async ({ page }) => {
    await page.goto('/');
    const marker = laneTrack(page, 'Scale').locator('.lane-marker').first();
    const startBox = await requireBoundingBox(marker);
    const startX = startBox.x + startBox.width / 2;
    const y = startBox.y + startBox.height / 2;

    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX - 200, y, { steps: 5 });
    await page.mouse.up();

    const laneBox = await requireBoundingBox(laneTrack(page, 'Scale'));
    const endBox = await requireBoundingBox(marker);
    // beat 0 renders at left:0 relative to the lane track's own left edge.
    expect(endBox.x).toBeCloseTo(laneBox.x, 0);
  });
});
