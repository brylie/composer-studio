import { expect, test } from '@playwright/test';
import { laneTrack, requireBoundingBox } from './lane-helpers.js';

// Phase 7 labels lane (tracks.md#labels-track-placeholder) — pointer
// interaction coverage mirrors scale-lane.e2e.ts/chord-lane.e2e.ts (same
// EventTrackLane component), plus the label-specific freeform-text editing
// behavior (empty text can't be saved).

test.describe('Labels lane', () => {
  test('starts with no markers', async ({ page }) => {
    await page.goto('/');
    await expect(laneTrack(page, 'Labels').locator('.lane-marker')).toHaveCount(0);
  });

  test('tapping empty lane space opens the label editor', async ({ page }) => {
    await page.goto('/');
    await laneTrack(page, 'Labels').click({ position: { x: 300, y: 13 } });
    await expect(page.locator('.overlay-title', { hasText: 'Label marker' })).toBeVisible();
  });

  test('a pan-like drag starting on empty lane space does not open the editor', async ({
    page,
  }) => {
    await page.goto('/');
    const box = await requireBoundingBox(laneTrack(page, 'Labels'));
    const y = box.y + box.height / 2;
    const startX = box.x + box.width / 2;

    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX + 30, y, { steps: 5 });
    await page.mouse.up();

    await expect(page.locator('.overlay-title', { hasText: 'Label marker' })).toBeHidden();
  });

  test('a marker cannot be created at or beyond the lane totalBeats boundary', async ({ page }) => {
    await page.goto('/');
    await page.locator('.scroll-area').evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });

    const track = laneTrack(page, 'Labels');
    const box = await requireBoundingBox(track);
    await track.click({ position: { x: box.width - 2, y: box.height / 2 } });

    const readout = page.locator('.beat-readout');
    await expect(readout).toBeVisible();
    const text = await readout.textContent();
    const beat = Number(text?.replace('Beat ', ''));
    expect(beat).toBeLessThan(64); // default totalBeats — the lane's own half-open upper bound
  });

  test('the add button stays disabled until text is entered', async ({ page }) => {
    await page.goto('/');
    await laneTrack(page, 'Labels').click({ position: { x: 0, y: 13 } });
    const addButton = page.getByRole('button', { name: 'Add label' });
    await expect(addButton).toBeDisabled();
    await page.locator('#label-text').fill('Solo starts here');
    await expect(addButton).toBeEnabled();
  });

  test('adding a label renders its text on the lane', async ({ page }) => {
    await page.goto('/');
    await laneTrack(page, 'Labels').click({ position: { x: 0, y: 13 } });
    await page.locator('#label-text').fill('Solo starts here');
    await page.getByRole('button', { name: 'Add label' }).click();

    await expect(page.locator('.overlay-title', { hasText: 'Label marker' })).toBeHidden();
    const marker = laneTrack(page, 'Labels').locator('.lane-marker').first();
    await expect(marker).toHaveText('Solo starts here');
  });

  test('clicking an existing label reopens the editor pre-filled, and delete removes it', async ({
    page,
  }) => {
    await page.goto('/');
    await laneTrack(page, 'Labels').click({ position: { x: 0, y: 13 } });
    await page.locator('#label-text').fill('Verse 2');
    await page.getByRole('button', { name: 'Add label' }).click();

    const marker = laneTrack(page, 'Labels').locator('.lane-marker').first();
    await expect(marker).toHaveText('Verse 2');
    await marker.click();

    await expect(page.locator('.overlay-title', { hasText: 'Label marker' })).toBeVisible();
    await expect(page.locator('#label-text')).toHaveValue('Verse 2');

    await page.getByRole('button', { name: 'Delete label' }).click();
    await expect(laneTrack(page, 'Labels').locator('.lane-marker')).toHaveCount(0);
  });

  test('dragging a label marker past the left edge clamps to beat 0', async ({ page }) => {
    await page.goto('/');
    await laneTrack(page, 'Labels').click({ position: { x: 300, y: 13 } });
    await page.locator('#label-text').fill('Chorus');
    await page.getByRole('button', { name: 'Add label' }).click();

    const marker = laneTrack(page, 'Labels').locator('.lane-marker').first();
    const startBox = await requireBoundingBox(marker);
    const startX = startBox.x + startBox.width / 2;
    const y = startBox.y + startBox.height / 2;

    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX - 500, y, { steps: 5 });
    await page.mouse.up();

    const laneBox = await requireBoundingBox(laneTrack(page, 'Labels'));
    const endBox = await requireBoundingBox(marker);
    expect(endBox.x).toBeCloseTo(laneBox.x, 0);
  });
});
