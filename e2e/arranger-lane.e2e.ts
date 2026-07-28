import { expect, test } from '@playwright/test';
import { laneTrack, requireBoundingBox } from './lane-helpers.js';

// Phase 9 arranger lane (tracks.md#arranger-track-placeholder) — v1 is
// annotation-only: add/move/resize/rename a labeled region, no content
// ripple. Unlike the scale/chord/labels lanes (EventTrackLane, a single
// beat marker per tap), a tap on empty arranger space commits a
// default-sized section immediately (no editor) since a section already has
// a sensible default the moment it exists; the editor only ever targets an
// *existing* section, opened by tapping its block (arranger-lane-editor.svelte.ts).

test.describe('Arranger lane', () => {
  test('starts with no sections', async ({ page }) => {
    await page.goto('/');
    await expect(laneTrack(page, 'Arranger').locator('.section-block')).toHaveCount(0);
  });

  test('tapping empty lane space adds a default section without opening an editor', async ({
    page,
  }) => {
    await page.goto('/');
    await laneTrack(page, 'Arranger').click({ position: { x: 0, y: 14 } });

    const block = laneTrack(page, 'Arranger').locator('.section-block').first();
    await expect(block).toBeVisible();
    await expect(block).toContainText('New section');
    await expect(page.locator('.overlay-title')).toBeHidden();
  });

  test('a pan-like drag starting on empty lane space does not add a section', async ({ page }) => {
    await page.goto('/');
    const box = await requireBoundingBox(laneTrack(page, 'Arranger'));
    const y = box.y + box.height / 2;
    const startX = box.x + box.width / 2;

    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX + 30, y, { steps: 5 });
    await page.mouse.up();

    await expect(laneTrack(page, 'Arranger').locator('.section-block')).toHaveCount(0);
  });

  test('tapping inside an existing section does not add a second, overlapping one', async ({
    page,
  }) => {
    await page.goto('/');
    const track = laneTrack(page, 'Arranger');
    await track.click({ position: { x: 0, y: 14 } });
    await expect(track.locator('.section-block')).toHaveCount(1);

    // The default section spans [0, 4) beats — 320px at the default 80px/beat
    // zoom — so a tap well inside it (not on an edge handle) must be treated
    // as a select, not a second add.
    await track.click({ position: { x: 100, y: 14 } });
    await expect(track.locator('.section-block')).toHaveCount(1);
  });

  test('a section cannot be added at or beyond the lane totalBeats boundary', async ({ page }) => {
    await page.goto('/');
    await page.locator('.scroll-area').evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });

    const track = laneTrack(page, 'Arranger');
    const trackBox = await requireBoundingBox(track);
    await track.click({ position: { x: trackBox.width - 2, y: 14 } });

    const block = track.locator('.section-block').first();
    await expect(block).toBeVisible();
    const blockBox = await requireBoundingBox(block);
    const laneBox = await requireBoundingBox(track);
    expect(blockBox.x + blockBox.width).toBeLessThanOrEqual(laneBox.x + laneBox.width + 1);
  });

  test('clicking an existing section opens the rename/delete editor pre-filled, and Update section renames it', async ({
    page,
  }) => {
    await page.goto('/');
    const track = laneTrack(page, 'Arranger');
    await track.click({ position: { x: 0, y: 14 } });

    const block = track.locator('.section-block').first();
    await block.click({ position: { x: 40, y: 5 } });

    await expect(page.locator('.overlay-title', { hasText: 'Arranger section' })).toBeVisible();
    await expect(page.locator('#section-label')).toHaveValue('New section');

    await page.locator('#section-label').fill('Verse');
    await page.getByRole('button', { name: 'Update section' }).click();

    await expect(page.locator('.overlay-title', { hasText: 'Arranger section' })).toBeHidden();
    await expect(block).toContainText('Verse');
  });

  test('Delete section removes the section', async ({ page }) => {
    await page.goto('/');
    const track = laneTrack(page, 'Arranger');
    await track.click({ position: { x: 0, y: 14 } });

    const block = track.locator('.section-block').first();
    await block.click({ position: { x: 40, y: 5 } });
    await page.getByRole('button', { name: 'Delete section' }).click();

    await expect(track.locator('.section-block')).toHaveCount(0);
  });

  test('dragging a section body moves it', async ({ page }) => {
    await page.goto('/');
    const track = laneTrack(page, 'Arranger');
    await track.click({ position: { x: 0, y: 14 } });

    const block = track.locator('.section-block').first();
    const startBox = await requireBoundingBox(block);
    const y = startBox.y + startBox.height / 2;

    await page.mouse.move(startBox.x + startBox.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(startBox.x + startBox.width / 2 + 240, y, { steps: 5 });
    await page.mouse.up();

    const endBox = await requireBoundingBox(block);
    expect(endBox.x).toBeGreaterThan(startBox.x + 100);
  });

  test('dragging a section past a neighbor clamps against it instead of overlapping', async ({
    page,
  }) => {
    await page.goto('/');
    const track = laneTrack(page, 'Arranger');
    // First section at beat 0 → [0, 4). Second tap lands inside a gap far
    // enough away to become its own section.
    await track.click({ position: { x: 0, y: 14 } });
    await track.click({ position: { x: 800, y: 14 } });
    await expect(track.locator('.section-block')).toHaveCount(2);

    const first = track.locator('.section-block').nth(0);
    const second = track.locator('.section-block').nth(1);
    const firstBox = await requireBoundingBox(first);
    const secondBoxStart = await requireBoundingBox(second);
    const y = secondBoxStart.y + secondBoxStart.height / 2;

    // Drag the second section all the way toward the first — it must stop
    // right at the first section's right edge, not overlap it.
    await page.mouse.move(secondBoxStart.x + secondBoxStart.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(firstBox.x + firstBox.width + 5, y, { steps: 10 });
    await page.mouse.up();

    const secondBoxEnd = await requireBoundingBox(second);
    expect(secondBoxEnd.x).toBeCloseTo(firstBox.x + firstBox.width, 0);
  });

  test('dragging the right edge resizes the section', async ({ page }) => {
    await page.goto('/');
    const track = laneTrack(page, 'Arranger');
    await track.click({ position: { x: 0, y: 14 } });

    const block = track.locator('.section-block').first();
    const startBox = await requireBoundingBox(block);
    const handle = block.locator('.resize-handle.right');
    const handleBox = await requireBoundingBox(handle);
    const y = handleBox.y + handleBox.height / 2;

    await page.mouse.move(handleBox.x + handleBox.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + 160, y, { steps: 5 });
    await page.mouse.up();

    const endBox = await requireBoundingBox(block);
    expect(endBox.x).toBeCloseTo(startBox.x, 0); // left edge unchanged
    expect(endBox.width).toBeGreaterThan(startBox.width + 100);
  });

  test('dragging the left edge resizes without moving the right edge', async ({ page }) => {
    await page.goto('/');
    const track = laneTrack(page, 'Arranger');
    await track.click({ position: { x: 400, y: 14 } });

    const block = track.locator('.section-block').first();
    const startBox = await requireBoundingBox(block);
    const rightEdge = startBox.x + startBox.width;
    const handle = block.locator('.resize-handle.left');
    const handleBox = await requireBoundingBox(handle);
    const y = handleBox.y + handleBox.height / 2;

    await page.mouse.move(handleBox.x + handleBox.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + 80, y, { steps: 5 });
    await page.mouse.up();

    const endBox = await requireBoundingBox(block);
    expect(endBox.x).toBeGreaterThan(startBox.x + 40);
    expect(endBox.x + endBox.width).toBeCloseTo(rightEdge, 0);
  });

  test('undo restores a deleted section', async ({ page }) => {
    await page.goto('/');
    const track = laneTrack(page, 'Arranger');
    await track.click({ position: { x: 0, y: 14 } });

    const block = track.locator('.section-block').first();
    await block.click({ position: { x: 40, y: 5 } });
    await page.getByRole('button', { name: 'Delete section' }).click();
    await expect(track.locator('.section-block')).toHaveCount(0);

    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect(track.locator('.section-block')).toHaveCount(1);
  });
});
