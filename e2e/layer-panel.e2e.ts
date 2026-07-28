import { expect, test } from '@playwright/test';
import { requireBoundingBox } from './lane-helpers.js';

// Phase 10 instrument layers (layers.md) — a reorderable layer panel over
// the piano roll's single shared Note[]/timeline: visibility/lock gate
// selection and rendering (never audio), reordering re-stacks z-order, and
// deleting a layer takes its notes with it (Photoshop analogy, one undo
// step). This suite exercises the panel plus its effect on the note grid,
// not the panel in isolation.

const NOTE_GRID = '.note-grid';

async function openLayerPanel(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Open layer panel' }).click();
}

function layerRow(page: import('@playwright/test').Page, index: number) {
  return page.locator('.layer-row').nth(index);
}

/** Draws a note by clicking empty grid space at a fixed, reproducible position (default 'draw' mode). */
async function drawNoteAt(page: import('@playwright/test').Page, x: number, y: number) {
  await page.locator(NOTE_GRID).click({ position: { x, y } });
}

test.describe('Layer panel', () => {
  test('starts with exactly one default layer, panel closed by default', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.overlay-title', { hasText: 'Layers' })).toBeHidden();

    await openLayerPanel(page);
    await expect(page.locator('.layer-row')).toHaveCount(1);
    await expect(layerRow(page, 0).locator('input[aria-label="Layer name"]')).toHaveValue('Piano');
  });

  test('Add layer creates a second row and makes it the active layer', async ({ page }) => {
    await page.goto('/');
    await openLayerPanel(page);

    await page.getByRole('button', { name: 'Add layer' }).click();
    await expect(page.locator('.layer-row')).toHaveCount(2);
    // addLayer prepends — the new layer is row 0, and is the active one.
    await expect(layerRow(page, 0).locator('input[aria-label="Layer name"]')).toHaveValue(
      'Layer 2',
    );
    await expect(layerRow(page, 0).locator('.active-dot')).toHaveAttribute('aria-checked', 'true');
    await expect(layerRow(page, 1).locator('.active-dot')).toHaveAttribute('aria-checked', 'false');
  });

  test('renaming a layer updates its row label', async ({ page }) => {
    await page.goto('/');
    await openLayerPanel(page);

    const nameInput = layerRow(page, 0).locator('input[aria-label="Layer name"]');
    await nameInput.fill('Strings');
    await nameInput.blur();
    await expect(nameInput).toHaveValue('Strings');
  });

  test('hiding a layer removes its notes from the grid; showing it again restores them', async ({
    page,
  }) => {
    await page.goto('/');
    await drawNoteAt(page, 100, 100);
    await expect(page.locator('.note')).toHaveCount(1);

    await openLayerPanel(page);
    await page.getByRole('button', { name: 'Hide Piano' }).click();
    await expect(page.locator('.note')).toHaveCount(0);

    await page.getByRole('button', { name: 'Show Piano' }).click();
    await expect(page.locator('.note')).toHaveCount(1);
  });

  test('locking a layer dims its note and blocks drag/delete, without muting it from the document', async ({
    page,
  }) => {
    await page.goto('/');
    await drawNoteAt(page, 100, 100);
    const note = page.locator('.note').first();
    const startBox = await requireBoundingBox(note);

    await openLayerPanel(page);
    await page.getByRole('button', { name: 'Lock Piano' }).click();
    await expect(note).toHaveClass(/locked/);
    // Close the panel before touching the grid — its full-viewport backdrop
    // would otherwise intercept the pointer events below.
    await page.locator('.overlay-close').click();

    // Dragging a locked note must not move it.
    await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(startBox.x + 200, startBox.y, { steps: 5 });
    await page.mouse.up();
    const afterDragBox = await requireBoundingBox(note);
    expect(afterDragBox.x).toBeCloseTo(startBox.x, 0);

    // Right-click delete on a locked note must not remove it.
    await note.click({ button: 'right' });
    await expect(page.locator('.note')).toHaveCount(1);

    // Unlocking restores normal interaction.
    await openLayerPanel(page);
    await page.getByRole('button', { name: 'Unlock Piano' }).click();
    await expect(note).not.toHaveClass(/locked/);
  });

  test('a locked layer keeps rendering (dimmed) — visibility and lock are independent controls', async ({
    page,
  }) => {
    await page.goto('/');
    await drawNoteAt(page, 100, 100);
    await openLayerPanel(page);
    await page.getByRole('button', { name: 'Lock Piano' }).click();
    await expect(page.locator('.note')).toHaveCount(1);
    await expect(page.locator('.note').first()).toBeVisible();
  });

  test('Ctrl+A select-all skips notes on a locked layer', async ({ page }) => {
    await page.goto('/');
    await drawNoteAt(page, 100, 100); // on the default (unlocked) layer

    await openLayerPanel(page);
    await page.getByRole('button', { name: 'Add layer' }).click();
    await page.locator('.overlay-close').click();

    await drawNoteAt(page, 300, 100); // on the new, active layer

    await openLayerPanel(page);
    await page.getByRole('button', { name: 'Lock Layer 2' }).click();
    await page.locator('.overlay-close').click();

    await page.keyboard.press('ControlOrMeta+a');
    await expect(page.locator('.note.selected')).toHaveCount(1);
  });

  test('deleting a non-last layer removes it and its notes in one step', async ({ page }) => {
    await page.goto('/');
    await openLayerPanel(page);
    await page.getByRole('button', { name: 'Add layer' }).click();
    await page.locator('.overlay-close').click();

    await drawNoteAt(page, 100, 100); // lands on the new active layer
    await expect(page.locator('.note')).toHaveCount(1);

    await openLayerPanel(page);
    await page.getByRole('button', { name: 'Delete Layer 2' }).click();
    await expect(page.locator('.layer-row')).toHaveCount(1);
    await expect(page.locator('.note')).toHaveCount(0);
  });

  test('the only remaining layer cannot be deleted', async ({ page }) => {
    await page.goto('/');
    await openLayerPanel(page);
    await expect(page.getByRole('button', { name: 'Delete Piano' })).toBeDisabled();
  });

  test('undo restores a deleted layer and its notes in one step', async ({ page }) => {
    await page.goto('/');
    await openLayerPanel(page);
    await page.getByRole('button', { name: 'Add layer' }).click();
    await page.locator('.overlay-close').click();
    await drawNoteAt(page, 100, 100);

    await openLayerPanel(page);
    await page.getByRole('button', { name: 'Delete Layer 2' }).click();
    await expect(page.locator('.layer-row')).toHaveCount(1);
    await page.locator('.overlay-close').click();

    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect(page.locator('.note')).toHaveCount(1);

    await openLayerPanel(page);
    await expect(page.locator('.layer-row')).toHaveCount(2);
  });

  test('copying a note, deleting its layer, then pasting lands the note on the new active layer', async ({
    page,
  }) => {
    await page.goto('/');
    await drawNoteAt(page, 100, 100); // on the default "Piano" layer

    await openLayerPanel(page);
    await page.getByRole('button', { name: 'Add layer' }).click(); // "Layer 2" becomes active
    await page.locator('.overlay-close').click();

    await page.locator('.note').first().click(); // select it (draw mode: click selects)
    await page.keyboard.press('ControlOrMeta+c');

    await openLayerPanel(page);
    await page.getByRole('button', { name: 'Delete Piano' }).click(); // takes the copied note with it
    await expect(page.locator('.layer-row')).toHaveCount(1);
    await page.locator('.overlay-close').click();
    await expect(page.locator('.note')).toHaveCount(0);

    await page.keyboard.press('ControlOrMeta+v');
    await expect(page.locator('.note')).toHaveCount(1); // pasted onto the remaining ("Layer 2") layer
  });

  test('dragging a layer row reorders the panel and changes note stacking order', async ({
    page,
  }) => {
    await page.goto('/');
    await drawNoteAt(page, 100, 100);
    const bottomNoteId = await page.locator('.note').first().getAttribute('data-note-id');

    await openLayerPanel(page);
    await page.getByRole('button', { name: 'Add layer' }).click(); // "Layer 2", topmost + active
    await page.locator('.overlay-close').click();
    await drawNoteAt(page, 300, 100);
    const topNoteId = await page.locator('.note').nth(1).getAttribute('data-note-id');

    // "Layer 2" (topmost, index 0) paints last — its note is later in DOM order.
    const notesBefore = await page
      .locator('.note')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-note-id')));
    expect(notesBefore).toEqual([bottomNoteId, topNoteId]);

    // Drag "Layer 2" (row 0) below "Piano" (row 1).
    await openLayerPanel(page);
    const handle = layerRow(page, 0).locator('.drag-handle');
    const handleBox = await requireBoundingBox(handle);
    const targetBox = await requireBoundingBox(layerRow(page, 1));

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height - 2, {
      steps: 5,
    });
    await page.mouse.up();

    await expect(layerRow(page, 0).locator('input[aria-label="Layer name"]')).toHaveValue('Piano');
    await expect(layerRow(page, 1).locator('input[aria-label="Layer name"]')).toHaveValue(
      'Layer 2',
    );

    // Stacking flips: "Piano" is topmost again, so its note now paints last.
    const notesAfter = await page
      .locator('.note')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-note-id')));
    expect(notesAfter).toEqual([topNoteId, bottomNoteId]);
  });
});
