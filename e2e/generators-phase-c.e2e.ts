import { expect, test } from '@playwright/test';

// Generators Phase C (generators.md §18): the bounded session region, the
// non-modal inspector, module-chain editing, and the Apply/Cancel lifecycle,
// exercised end to end through the Generate ribbon tab's "Pulse" starter —
// the one V1 generator wired to the shared session/evaluator infrastructure
// built in Phases A/B.

async function startPulseGenerator(page: import('@playwright/test').Page) {
  await page.getByRole('tab', { name: 'Generate' }).click();
  await page.getByRole('button', { name: 'Pulse' }).click();
}

/** Committed document notes only — a live preview note also carries the shared `.note` class. */
function committedNotes(page: import('@playwright/test').Page) {
  return page.locator('.note:not(.preview-note)');
}

/**
 * A stable per-note signature of the current preview (each note's left/top/
 * width inline style, which encode start beat, pitch, and duration) — a mere
 * `.preview-note` *count* can't distinguish "the pattern changed" from "the
 * same pattern happened to reroll to itself," and a reroll that only moves
 * rests around wouldn't necessarily change the count at all.
 */
async function previewSignature(page: import('@playwright/test').Page): Promise<string[]> {
  const styles = await page
    .locator('.preview-note')
    .evaluateAll((els) => els.map((el) => el.getAttribute('style') ?? ''));
  return styles.sort();
}

test.describe('Generators — Phase C session UX', () => {
  test('starting a generator shows a bounded region, live preview notes, and the inspector', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(committedNotes(page)).toHaveCount(0);

    await startPulseGenerator(page);

    await expect(page.locator('.generator-region')).toBeVisible();
    await expect(page.locator('[aria-label="Generator inspector"]')).toBeVisible();
    // Preview notes are live (audible/visible) before Apply, but aren't
    // committed document notes yet.
    await expect(page.locator('.preview-note').first()).toBeVisible();
    await expect(committedNotes(page)).toHaveCount(0);
  });

  test('Apply commits the current preview as ordinary notes and closes the session', async ({
    page,
  }) => {
    await page.goto('/');
    await startPulseGenerator(page);
    const previewCount = await page.locator('.preview-note').count();
    expect(previewCount).toBeGreaterThan(0);

    await page.locator('.inspector').getByRole('button', { name: 'Apply' }).click();

    await expect(page.locator('[aria-label="Generator inspector"]')).toBeHidden();
    await expect(page.locator('.generator-region')).toBeHidden();
    await expect(committedNotes(page)).toHaveCount(previewCount);
    await expect(page.locator('.preview-note')).toHaveCount(0);
  });

  test('Cancel discards the session without adding any notes', async ({ page }) => {
    await page.goto('/');
    await startPulseGenerator(page);

    await page.locator('.inspector').getByRole('button', { name: 'Cancel' }).click();

    await expect(page.locator('[aria-label="Generator inspector"]')).toBeHidden();
    await expect(page.locator('.generator-region')).toBeHidden();
    await expect(committedNotes(page)).toHaveCount(0);
  });

  test('editing the end-beat field resizes the region and changes the preview', async ({
    page,
  }) => {
    await page.goto('/');
    await startPulseGenerator(page);

    const initialWidth = (await page.locator('.generator-region').boundingBox())?.width ?? 0;
    const initialCount = await page.locator('.preview-note').count();

    const endBeatField = page.getByRole('spinbutton', { name: 'End beat', exact: true });
    await endBeatField.fill('16');
    await endBeatField.blur();

    await expect
      .poll(async () => (await page.locator('.generator-region').boundingBox())?.width ?? 0)
      .toBeGreaterThan(initialWidth);
    await expect
      .poll(async () => page.locator('.preview-note').count())
      .toBeGreaterThan(initialCount);
  });

  test('bypassing the note renderer module shows an error diagnostic without crashing the session', async ({
    page,
  }) => {
    await page.goto('/');
    await startPulseGenerator(page);
    await expect(page.locator('.preview-note').first()).toBeVisible();
    const previewCount = await page.locator('.preview-note').count();

    // Module cards render as ["Pulse" source, "Note renderer"] by default.
    await page.getByRole('button', { name: 'Bypass Note renderer' }).click();

    await expect(page.locator('.inspector .status-error')).toBeVisible();
    await expect(page.locator('.diagnostics-list .diagnostic-error').first()).toBeVisible();
    // evaluateSession() deliberately keeps the session's last successful
    // `result` on a failed evaluation (generators.md §6.2) rather than
    // clearing it, so the pre-bypass preview notes are still exactly what's
    // rendered here — not zero. That staleness is exactly why Apply must be
    // disabled in the error state (guarded separately below and in
    // GeneratorInspector/RibbonPanel), rather than the preview itself
    // disappearing.
    await expect(page.locator('.preview-note')).toHaveCount(previewCount);
    // Apply must not be offered while there's nothing valid to commit — it
    // would otherwise silently discard the stale preview instead of
    // applying it (the bug the disabled state above guards against).
    await expect(page.locator('.inspector').getByRole('button', { name: 'Apply' })).toBeDisabled();
    // The session survives the error (stale preview, but no crash) and can be cancelled.
    await page.locator('.inspector').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('[aria-label="Generator inspector"]')).toBeHidden();
  });

  test('reroll changes the preview note pattern while keeping the session open', async ({
    page,
  }) => {
    await page.goto('/');
    await startPulseGenerator(page);

    // Widen the bounds and dial up the rest chance so the two generations'
    // random rest patterns are overwhelmingly likely to differ.
    const endBeatField = page.getByRole('spinbutton', { name: 'End beat', exact: true });
    await endBeatField.fill('32');
    await endBeatField.blur();
    const restField = page.getByRole('slider', { name: 'Rest chance' });
    await restField.focus();
    await restField.press('End'); // jumps an <input type="range"> to its max

    const before = await previewSignature(page);

    await page.locator('.inspector').getByRole('button', { name: 'Reroll' }).click();

    await expect.poll(() => previewSignature(page)).not.toEqual(before);
    // The session stays open — reroll doesn't Apply or Cancel.
    await expect(page.locator('[aria-label="Generator inspector"]')).toBeVisible();
  });

  test('adding a Transpose module inserts a new module card wired after the note renderer', async ({
    page,
  }) => {
    await page.goto('/');
    await startPulseGenerator(page);
    await expect(page.locator('.module-card')).toHaveCount(2);

    // Select the "Note renderer" module (the chain's last, notes-producing
    // node) so the new module is appended after it — appending after the
    // "Pulse" rhythm source instead would be an incompatible connection.
    await page.locator('.module-card .module-select').nth(1).click();

    await page.getByLabel('Module to add').selectOption('transpose-notes');
    await page.getByRole('button', { name: 'Add module' }).click();

    await expect(page.locator('.module-card')).toHaveCount(3);
    await expect(page.locator('.module-card', { hasText: 'Transpose' })).toBeVisible();
    await expect(page.locator('.chain-error')).toHaveCount(0);
  });

  test('the whole workflow works without a pointer: keyboard-driven bounds resize', async ({
    page,
  }) => {
    await page.goto('/');
    await startPulseGenerator(page);

    const endBeatField = page.getByRole('spinbutton', { name: 'End beat', exact: true });
    const endHandle = page.getByRole('button', { name: 'Resize generator end beat' });
    await endHandle.focus();
    const before = await endBeatField.inputValue();
    await endHandle.press('ArrowRight');

    await expect.poll(() => endBeatField.inputValue()).not.toEqual(before);
  });

  test('the region body is keyboard-movable, not just its resize handles', async ({ page }) => {
    await page.goto('/');
    await startPulseGenerator(page);

    const startBeatField = page.getByRole('spinbutton', { name: 'Start beat', exact: true });
    const regionBody = page.getByRole('button', { name: 'Move generator region' });
    await regionBody.focus();
    const before = await startBeatField.inputValue();
    await regionBody.press('ArrowRight');

    await expect.poll(() => startBeatField.inputValue()).not.toEqual(before);
  });

  test('ArrowUp on the region body raises pitch; ArrowDown lowers it', async ({ page }) => {
    await page.goto('/');
    await startPulseGenerator(page);

    const minPitchField = page.getByRole('spinbutton', { name: 'Min pitch', exact: true });
    const regionBody = page.getByRole('button', { name: 'Move generator region' });
    await regionBody.focus();
    const initial = Number(await minPitchField.inputValue());

    await regionBody.press('ArrowUp');
    await expect
      .poll(async () => Number(await minPitchField.inputValue()))
      .toBeGreaterThan(initial);

    await regionBody.press('ArrowDown');
    await expect.poll(async () => Number(await minPitchField.inputValue())).toBe(initial);
  });
});
