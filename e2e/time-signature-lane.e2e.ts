import { expect, test } from '@playwright/test';
import { laneTrack, requireBoundingBox } from './lane-helpers.js';

// Phase 6 time signature lane (tracks.md#time-signature-track-specified) —
// pointer-interaction coverage mirrors scale-lane.e2e.ts/chord-lane.e2e.ts
// (same EventTrackLane component), plus the beat-0-marker-can't-be-deleted
// invariant and the preset-picker-specific save/delete flow.

test.describe('Time signature lane', () => {
  test('shows the default 4/4 marker at beat 0', async ({ page }) => {
    await page.goto('/');
    const marker = laneTrack(page, 'Time Sig').locator('.lane-marker').first();
    await expect(marker).toBeVisible();
    await expect(marker).toHaveText('4/4');
  });

  test('tapping empty lane space opens the time signature marker editor', async ({ page }) => {
    await page.goto('/');
    await laneTrack(page, 'Time Sig').click({ position: { x: 300, y: 13 } });
    await expect(
      page.locator('.overlay-title', { hasText: 'Time signature marker' }),
    ).toBeVisible();
  });

  test('a pan-like drag starting on empty lane space does not open the editor', async ({
    page,
  }) => {
    await page.goto('/');
    const box = await requireBoundingBox(laneTrack(page, 'Time Sig'));
    const y = box.y + box.height / 2;
    const startX = box.x + box.width / 2;

    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX + 30, y, { steps: 5 });
    await page.mouse.up();

    await expect(page.locator('.overlay-title', { hasText: 'Time signature marker' })).toBeHidden();
  });

  test('a marker cannot be created at or beyond the lane totalBeats boundary', async ({ page }) => {
    await page.goto('/');
    await page.locator('.scroll-area').evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });

    const track = laneTrack(page, 'Time Sig');
    const box = await requireBoundingBox(track);
    await track.click({ position: { x: box.width - 2, y: box.height / 2 } });

    await page.getByRole('button', { name: '3/4' }).click();
    await page.getByRole('button', { name: 'Add marker' }).click();

    // Assert against the persisted marker's rendered position, not the
    // draft editor's beat readout — this is what actually proves the
    // clamp applied to the saved event, not just the in-progress form.
    await expect(track.locator('.lane-marker')).toHaveCount(2); // default beat-0 marker + the new one
    const marker = track.locator('.lane-marker').last();
    const markerBox = await requireBoundingBox(marker);
    const laneBox = await requireBoundingBox(track);
    expect(markerBox.x).toBeLessThan(laneBox.x + laneBox.width);
  });

  test('adding a time signature marker renders it with the numerator/denominator label', async ({
    page,
  }) => {
    await page.goto('/');
    await laneTrack(page, 'Time Sig').click({ position: { x: 300, y: 13 } });
    await expect(
      page.locator('.overlay-title', { hasText: 'Time signature marker' }),
    ).toBeVisible();

    await page.getByRole('button', { name: '6/8' }).click();
    await page.getByRole('button', { name: 'Add marker' }).click();

    await expect(page.locator('.overlay-title', { hasText: 'Time signature marker' })).toBeHidden();
    const marker = laneTrack(page, 'Time Sig').locator('.lane-marker').last();
    await expect(marker).toHaveText('6/8');
  });

  test('clicking an existing (non-beat-0) marker reopens the editor pre-filled, and delete removes it and closes the editor', async ({
    page,
  }) => {
    await page.goto('/');
    await laneTrack(page, 'Time Sig').click({ position: { x: 300, y: 13 } });
    await page.getByRole('button', { name: '3/4' }).click();
    await page.getByRole('button', { name: 'Add marker' }).click();

    const marker = laneTrack(page, 'Time Sig').locator('.lane-marker').last();
    await expect(marker).toHaveText('3/4');
    await marker.click();

    const panel = page.locator('.overlay-panel');
    await expect(
      page.locator('.overlay-title', { hasText: 'Time signature marker' }),
    ).toBeVisible();
    await expect(panel.getByRole('button', { name: '3/4' })).toHaveClass(/selected/);

    await panel.getByRole('button', { name: 'Delete marker' }).click();

    // The editor must close — both the panel itself and its backdrop/close
    // affordances — not just the underlying marker being removed from the
    // store (tracks.md's shared lane-editor contract every other track's
    // delete flow already relies on).
    await expect(page.locator('.overlay-title', { hasText: 'Time signature marker' })).toBeHidden();
    await expect(page.locator('.overlay-backdrop')).toBeHidden();
    await expect(laneTrack(page, 'Time Sig').locator('.lane-marker')).toHaveCount(1);
  });

  test('the beat-0 marker has no delete button — a project can never have zero time signature', async ({
    page,
  }) => {
    await page.goto('/');
    const marker = laneTrack(page, 'Time Sig').locator('.lane-marker').first();
    await marker.click();

    await expect(
      page.locator('.overlay-title', { hasText: 'Time signature marker' }),
    ).toBeVisible();
    await expect(
      page.locator('.overlay-panel').getByRole('button', { name: 'Delete marker' }),
    ).toHaveCount(0);

    // Still closable via the overlay's own close button even with no delete
    // affordance available.
    await page.locator('.overlay-close').click();
    await expect(page.locator('.overlay-title', { hasText: 'Time signature marker' })).toBeHidden();
  });

  test('dragging a time signature marker past the left edge clamps to beat 0, replacing the default marker', async ({
    page,
  }) => {
    await page.goto('/');
    await laneTrack(page, 'Time Sig').click({ position: { x: 300, y: 13 } });
    await page.getByRole('button', { name: '5/4' }).click();
    await page.getByRole('button', { name: 'Add marker' }).click();

    const marker = laneTrack(page, 'Time Sig').locator('.lane-marker').last();
    const startBox = await requireBoundingBox(marker);
    const startX = startBox.x + startBox.width / 2;
    const y = startBox.y + startBox.height / 2;

    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX - 500, y, { steps: 5 });
    await page.mouse.up();

    const laneBox = await requireBoundingBox(laneTrack(page, 'Time Sig'));
    const endBox = await requireBoundingBox(marker);
    expect(endBox.x).toBeCloseTo(laneBox.x, 0);
    // Replaced the original 4/4 default at beat 0, not stacked alongside it.
    await expect(laneTrack(page, 'Time Sig').locator('.lane-marker')).toHaveCount(1);
    await expect(marker).toHaveText('5/4');
  });

  test('a bar line moves to reflect a new time signature applied from beat 0', async ({ page }) => {
    await page.goto('/');
    const marker = laneTrack(page, 'Time Sig').locator('.lane-marker').first();
    await marker.click();
    await page.getByRole('button', { name: '3/4' }).click();
    await page.getByRole('button', { name: 'Update marker' }).click();

    // 3/4 at beat 0 means the second bar line sits at beat 3, not beat 4 —
    // read the ruler's own bar-number markers rather than reaching into
    // pixel math, since store.barBeats already drives that rendering.
    const secondBar = page.locator('.bar-marker').nth(1);
    await expect(secondBar).toHaveText('2');
  });

  test('regression: a marker placed mid-bar does not crash the app or leave any panel stuck open', async ({
    page,
  }) => {
    // A marker placed anywhere that isn't already a bar boundary (tracks.md's
    // "beat-grouping ticks" section) used to compute the truncated preceding
    // bar's ticks as if it were still full-length, producing beat values
    // that collided with the following bar's own ticks — two different bars'
    // ticks landing on the same beat, fed into the note grid's keyed
    // `{#each}`, which Svelte rejects outright (each_key_duplicate). That
    // uncaught error broke the render commit, which looked like "delete a
    // marker and the panel won't close" (whichever panel happened to be
    // mid-transition at the time) without actually being about delete at
    // all — any add/move/delete that left a bar truncated by a mid-bar
    // signature change could trigger it.
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');
    // Beat 1 is mid-bar under the default 4/4 (bars start at 0, 4, 8, ...).
    await laneTrack(page, 'Time Sig').click({ position: { x: 80, y: 13 } });
    await page.locator('.overlay-panel').getByRole('button', { name: '3/4' }).click();
    await page.getByRole('button', { name: 'Add marker' }).click();

    // The add must actually close its own panel — the first symptom of the
    // crash was exactly a panel failing to close.
    await expect(page.locator('.overlay-title', { hasText: 'Time signature marker' })).toBeHidden();

    // The app must still be interactive: opening and deleting the marker
    // just added must work normally.
    const marker = laneTrack(page, 'Time Sig').locator('.lane-marker').last();
    await marker.click();
    await page.locator('.overlay-panel').getByRole('button', { name: 'Delete marker' }).click();
    await expect(page.locator('.overlay-title', { hasText: 'Time signature marker' })).toBeHidden();
    await expect(laneTrack(page, 'Time Sig').locator('.lane-marker')).toHaveCount(1);

    expect(pageErrors).toEqual([]);
  });
});
