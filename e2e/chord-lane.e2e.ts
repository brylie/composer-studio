import { expect, test } from '@playwright/test';
import { laneTrack, requireBoundingBox } from './lane-helpers.js';

// Phase 7 chord lane (tracks.md#chord-track-placeholder) — pointer
// interaction coverage mirrors scale-lane.e2e.ts (same EventTrackLane
// component, same tap-vs-pan/boundary-clamp concerns), plus coverage for the
// chord-tone/tension highlighting the chord track newly drives in the note
// grid and piano-keys column.

test.describe('Chord lane', () => {
  test('starts with no markers', async ({ page }) => {
    await page.goto('/');
    await expect(laneTrack(page, 'Chord').locator('.lane-marker')).toHaveCount(0);
  });

  test('tapping empty lane space opens the chord marker editor', async ({ page }) => {
    await page.goto('/');
    await laneTrack(page, 'Chord').click({ position: { x: 300, y: 13 } });
    await expect(page.locator('.overlay-title', { hasText: 'Chord marker' })).toBeVisible();
  });

  test('a pan-like drag starting on empty lane space does not open the editor', async ({
    page,
  }) => {
    await page.goto('/');
    const box = await requireBoundingBox(laneTrack(page, 'Chord'));
    const y = box.y + box.height / 2;
    const startX = box.x + box.width / 2;

    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX + 30, y, { steps: 5 });
    await page.mouse.up();

    await expect(page.locator('.overlay-title', { hasText: 'Chord marker' })).toBeHidden();
  });

  test('a marker cannot be created at or beyond the lane totalBeats boundary', async ({ page }) => {
    await page.goto('/');
    await page.locator('.scroll-area').evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });

    const track = laneTrack(page, 'Chord');
    const box = await requireBoundingBox(track);
    await track.click({ position: { x: box.width - 2, y: box.height / 2 } });

    const readout = page.locator('.beat-readout');
    await expect(readout).toBeVisible();
    const text = await readout.textContent();
    const beat = Number(text?.replace('Beat ', ''));
    expect(beat).toBeLessThan(64); // default totalBeats — the lane's own half-open upper bound
  });

  test('adding a chord marker renders it with the root + quality label', async ({ page }) => {
    await page.goto('/');
    await laneTrack(page, 'Chord').click({ position: { x: 0, y: 13 } });
    await expect(page.locator('.overlay-title', { hasText: 'Chord marker' })).toBeVisible();

    await page.locator('#chord-root').selectOption('0'); // C
    await page.locator('#chord-quality').selectOption('maj7');
    await page.getByRole('button', { name: 'Add marker' }).click();

    await expect(page.locator('.overlay-title', { hasText: 'Chord marker' })).toBeHidden();
    const marker = laneTrack(page, 'Chord').locator('.lane-marker').first();
    await expect(marker).toHaveText('Cmaj7');
  });

  test('clicking an existing chord marker reopens the editor pre-filled, and delete removes it', async ({
    page,
  }) => {
    await page.goto('/');
    await laneTrack(page, 'Chord').click({ position: { x: 0, y: 13 } });
    await page.locator('#chord-root').selectOption('7'); // G
    await page.locator('#chord-quality').selectOption('7');
    await page.getByRole('button', { name: 'Add marker' }).click();

    const marker = laneTrack(page, 'Chord').locator('.lane-marker').first();
    await expect(marker).toHaveText('G7');
    await marker.click();

    await expect(page.locator('.overlay-title', { hasText: 'Chord marker' })).toBeVisible();
    await expect(page.locator('#chord-root')).toHaveValue('7');
    await expect(page.locator('#chord-quality')).toHaveValue('7');

    await page.getByRole('button', { name: 'Delete marker' }).click();
    await expect(laneTrack(page, 'Chord').locator('.lane-marker')).toHaveCount(0);
  });

  test('a diatonic chord tone highlights in the note grid alongside the existing scale highlight', async ({
    page,
  }) => {
    await page.goto('/');
    // Default scale is C major at beat 0 — a C major triad is fully diatonic.
    await laneTrack(page, 'Chord').click({ position: { x: 0, y: 13 } });
    await page.locator('#chord-root').selectOption('0'); // C
    await page.locator('#chord-quality').selectOption('maj');
    await page.getByRole('button', { name: 'Add marker' }).click();

    await expect(page.locator('.chord-highlight')).not.toHaveCount(0);
    await expect(page.locator('.chord-highlight.tension')).toHaveCount(0);
  });

  test('a non-diatonic chord tone gets the tension highlight treatment', async ({ page }) => {
    await page.goto('/');
    // Default scale is C major — a C# major triad is entirely non-diatonic
    // except its fifth (F), so this must produce at least one tension row.
    await laneTrack(page, 'Chord').click({ position: { x: 0, y: 13 } });
    await page.locator('#chord-root').selectOption('1'); // C#
    await page.locator('#chord-quality').selectOption('maj');
    await page.getByRole('button', { name: 'Add marker' }).click();

    await expect(page.locator('.chord-highlight.tension')).not.toHaveCount(0);
  });
});
