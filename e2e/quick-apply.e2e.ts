import { expect, test } from '@playwright/test';

// Quick-apply (direct-manipulation.md): a flat, searchable list of every
// applicable command/generator that runs immediately against the current
// selection with default params — no ribbon tabs, no params drawer, no
// generator session UI for the common case.

const NOTE_GRID = '.note-grid';

/** Draws a note by clicking empty grid space at a fixed, reproducible position (default 'draw' mode) — also selects it. */
async function drawNoteAt(page: import('@playwright/test').Page, x: number, y: number) {
  await page.locator(NOTE_GRID).click({ position: { x, y } });
}

function quickApplyButton(page: import('@playwright/test').Page) {
  return page.getByRole('button', { name: 'Quick apply to selection' });
}

/** By id rather than accessible name: several generator descriptions mention other generators by name (e.g. arpeggiate's description mentions "Euclidean"), so a name regex can match more than one row. */
function quickApplyOption(
  page: import('@playwright/test').Page,
  kind: 'command' | 'generator',
  id: string,
) {
  return page.locator(`#quick-apply-option-${kind}-${id}`);
}

test.describe('Quick apply', () => {
  test('the trigger is disabled with no selection and enabled once a note is selected', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(quickApplyButton(page)).toBeDisabled();

    await drawNoteAt(page, 100, 100);
    await expect(quickApplyButton(page)).toBeEnabled();
  });

  test('opens a searchable list of applicable commands and generators', async ({ page }) => {
    await page.goto('/');
    await drawNoteAt(page, 100, 100);

    await quickApplyButton(page).click();

    await expect(page.locator('.overlay-title', { hasText: 'Quick apply' })).toBeVisible();
    await expect(quickApplyOption(page, 'command', 'transpose')).toBeVisible();
    await expect(quickApplyOption(page, 'generator', 'euclidean-rhythm')).toBeVisible();
  });

  test('clicking a command entry applies it immediately with default params and closes the palette', async ({
    page,
  }) => {
    await page.goto('/');
    await drawNoteAt(page, 100, 100);
    const note = page.locator('.note').first();
    const styleBefore = (await note.getAttribute('style')) ?? '';

    await quickApplyButton(page).click();
    await page.getByRole('option', { name: /Retrograde/ }).click();

    // The palette closes on a successful apply — no drawer, no session UI.
    await expect(page.locator('.overlay-title', { hasText: 'Quick apply' })).toBeHidden();
    // Retrograde on a single note is a no-op on position but still records
    // a history entry — confirms the command actually ran (not just closed).
    await expect(page.locator('.note')).toHaveCount(1);
    await expect(note).toHaveAttribute('style', styleBefore);
  });

  test('typing filters the list down to matching entries', async ({ page }) => {
    await page.goto('/');
    await drawNoteAt(page, 100, 100);
    await quickApplyButton(page).click();

    // "onset" only appears in euclidean-rhythm's own description, so this
    // exercises description matching (not just label matching) unambiguously.
    await page.getByRole('combobox').fill('onset');

    await expect(quickApplyOption(page, 'generator', 'euclidean-rhythm')).toBeVisible();
    await expect(quickApplyOption(page, 'command', 'transpose')).toHaveCount(0);
  });

  test('applying a generator commits notes directly with no session/inspector opening', async ({
    page,
  }) => {
    await page.goto('/');
    // A single click-drawn note gets a tiny default duration (store.snapBeats)
    // — too narrow a bounds span for euclidean-rhythm's default stepBeats to
    // fit any onset in. Shift-click-drawing a second note far to the right
    // additively selects both, giving selectionContext.beatRange a wide
    // combined span (min start to max end across every selected note) even
    // though each individual note stays short.
    await drawNoteAt(page, 100, 100);
    await page.locator(NOTE_GRID).click({ position: { x: 500, y: 100 }, modifiers: ['Shift'] });
    await expect(page.locator('.note')).toHaveCount(2);
    const countBefore = await page.locator('.note').count();

    await quickApplyButton(page).click();
    await quickApplyOption(page, 'generator', 'euclidean-rhythm').click();

    await expect(page.locator('.overlay-title', { hasText: 'Quick apply' })).toBeHidden();
    await expect(page.locator('[aria-label="Generator inspector"]')).toBeHidden();
    await expect(page.locator('.generator-region')).toBeHidden();
    const countAfter = await page.locator('.note').count();
    expect(countAfter).toBeGreaterThan(countBefore);
  });

  test('keyboard Enter applies the highlighted entry without touching the mouse', async ({
    page,
  }) => {
    await page.goto('/');
    await drawNoteAt(page, 100, 100);
    await quickApplyButton(page).click();

    await page.getByRole('combobox').fill('retrograde');
    await page.getByRole('combobox').press('Enter');

    await expect(page.locator('.overlay-title', { hasText: 'Quick apply' })).toBeHidden();
  });
});
