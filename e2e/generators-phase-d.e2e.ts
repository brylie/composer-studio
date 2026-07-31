import { expect, test } from '@playwright/test';
import { laneTrack } from './lane-helpers.js';

// Generators Phase D (generators.md §18): the migrated generate-chords
// generator plus the newly-implemented arpeggiate, euclidean-rhythm,
// ostinato-generate, and motif-generate starters, exercised end to end
// through the same session/inspector infrastructure Phase C's Pulse tests
// cover (generators-phase-c.e2e.ts) — here focused on what's new: real
// harmony-sourced chains, manually composing modules across plan kinds
// (generators.md §17's "add Arpeggiate and Euclidean Gate in sequence"), and
// context staleness against the chord track.

async function startGenerator(page: import('@playwright/test').Page, label: string) {
  await page.getByRole('tab', { name: 'Generate' }).click();
  await page.getByRole('button', { name: label, exact: true }).click();
}

/** Places a chord marker on the chord lane at the given pixel x. */
async function addChordMarker(
  page: import('@playwright/test').Page,
  x: number,
  root: string,
  quality: string,
) {
  await laneTrack(page, 'Chord').click({ position: { x, y: 13 } });
  await page.locator('#chord-root').selectOption(root);
  await page.locator('#chord-quality').selectOption(quality);
  await page.getByRole('button', { name: 'Add marker' }).click();
}

function committedNotes(page: import('@playwright/test').Page) {
  return page.locator('.note:not(.preview-note)');
}

test.describe('Generators — Phase D migrated/implemented catalog', () => {
  test('Chords generator voices the chord track into live preview notes and Apply commits them', async ({
    page,
  }) => {
    await page.goto('/');
    await addChordMarker(page, 0, '0', 'maj7');
    await expect(laneTrack(page, 'Chord').locator('.lane-marker')).toHaveCount(1);

    await startGenerator(page, 'Chords');
    await expect(page.locator('.generator-region')).toBeVisible();
    await expect(page.locator('.preview-note').first()).toBeVisible();
    const previewCount = await page.locator('.preview-note').count();
    expect(previewCount).toBeGreaterThan(0);

    await page.locator('.inspector').getByRole('button', { name: 'Apply' }).click();
    await expect(page.locator('[aria-label="Generator inspector"]')).toBeHidden();
    await expect(committedNotes(page)).toHaveCount(previewCount);

    // Apply creates exactly one undoable document-history entry (generators.md §4.6, §19).
    const undoButton = page.getByRole('button', { name: /^Undo/ });
    await expect(undoButton).toBeEnabled();
    await undoButton.click();
    await expect(committedNotes(page)).toHaveCount(0);
  });

  test("Arpeggiate's default recipe combines a harmony operator with a rhythm operator (generators.md §8.1, §19)", async ({
    page,
  }) => {
    await page.goto('/');
    await addChordMarker(page, 0, '0', 'maj7');

    await startGenerator(page, 'Arpeggiate');
    await expect(page.locator('.generator-region')).toBeVisible();
    // chord-source -> smooth-voicing -> arpeggiate -> euclidean-gate -> event-render-notes.
    await expect(page.locator('.module-card')).toHaveCount(5);
    await expect(page.locator('.module-card', { hasText: 'Chord source' })).toBeVisible();
    await expect(page.locator('.module-card', { hasText: 'Euclidean gate' })).toBeVisible();
    await expect(page.locator('.preview-note').first()).toBeVisible();
  });

  test('bypassing the Euclidean gate in the Arpeggiate chain ungates events and changes the preview', async ({
    page,
  }) => {
    await page.goto('/');
    await addChordMarker(page, 0, '0', 'maj7');
    await startGenerator(page, 'Arpeggiate');
    await expect(page.locator('.preview-note').first()).toBeVisible();
    const gatedCount = await page.locator('.preview-note').count();

    await page.getByRole('button', { name: 'Bypass Euclidean gate' }).click();

    // A bypassed identity-capable 'events' processor passes its input
    // through unchanged (evaluator.ts's bypassOutputs), so every arpeggiated
    // event survives instead of only the gated subset — strictly more notes.
    await expect.poll(() => page.locator('.preview-note').count()).toBeGreaterThan(gatedCount);
    await expect(page.locator('.inspector .status-error')).toHaveCount(0);
  });

  test('adding Arpeggiate and Euclidean gate in sequence to a manually-composed chain (generators.md §17)', async ({
    page,
  }) => {
    await page.goto('/');
    await addChordMarker(page, 0, '0', 'maj7');
    // Chords starts as a 3-node chain: chord-source -> smooth-voicing -> event-render-notes.
    await startGenerator(page, 'Chords');
    await expect(page.locator('.module-card')).toHaveCount(3);

    // Select "Smooth voicing" (index 1) so the new module is inserted right
    // after it, ahead of the existing note renderer.
    await page.locator('.module-card .module-select').nth(1).click();
    await page.getByLabel('Module to add').selectOption('arpeggiate');
    await page.getByRole('button', { name: 'Add module' }).click();
    await expect(page.locator('.module-card')).toHaveCount(4);
    await expect(page.locator('.chain-error')).toHaveCount(0);

    // Select the newly-inserted "Arpeggiate" module (index 2) and add
    // Euclidean gate right after it, ahead of the note renderer.
    await page.locator('.module-card .module-select').nth(2).click();
    await page.getByLabel('Module to add').selectOption('euclidean-gate');
    await page.getByRole('button', { name: 'Add module' }).click();
    await expect(page.locator('.module-card')).toHaveCount(5);
    await expect(page.locator('.chain-error')).toHaveCount(0);

    await expect(page.locator('.module-card', { hasText: 'Arpeggiate' })).toBeVisible();
    await expect(page.locator('.module-card', { hasText: 'Euclidean gate' })).toBeVisible();
    await expect(page.locator('.preview-note').first()).toBeVisible();
  });

  test('reordering two modules recomputes a deterministically different output', async ({
    page,
  }) => {
    await page.goto('/');
    // Two markers inside the default [0, 4) bounds give smooth-voicing two
    // segments to emit, so gating before arpeggiating (below) thins the
    // input rather than trivially zeroing it out.
    await addChordMarker(page, 0, '0', 'maj7');
    await addChordMarker(page, 160, '7', '7');
    await startGenerator(page, 'Arpeggiate');
    await expect(page.locator('.preview-note').first()).toBeVisible();

    async function signature() {
      return (
        await page
          .locator('.preview-note')
          .evaluateAll((els) => els.map((el) => el.getAttribute('style') ?? ''))
      ).sort();
    }
    const before = await signature();

    // Move "Euclidean gate" (index 3) up, ahead of "Arpeggiate" — a
    // topologically different chain (gate the raw voiced chord, then
    // arpeggiate what survives) that should produce a different preview.
    await page.getByRole('button', { name: 'Move Euclidean gate up' }).click();

    await expect.poll(signature).not.toEqual(before);
    await expect(page.locator('.chain-error')).toHaveCount(0);
  });

  test('Euclidean generator: increasing pulses increases the number of preview onsets', async ({
    page,
  }) => {
    await page.goto('/');
    await startGenerator(page, 'Euclidean');
    await expect(page.locator('.preview-note').first()).toBeVisible();
    const initialCount = await page.locator('.preview-note').count();

    await page.locator('.module-card .module-select').first().click();
    const pulsesField = page.getByRole('spinbutton', { name: 'Pulses', exact: true });
    await pulsesField.fill('8'); // the default `steps` is also 8, so this densifies to every step
    await pulsesField.blur();

    await expect.poll(() => page.locator('.preview-note').count()).toBeGreaterThan(initialCount);
  });

  test('Ostinato generator repeats a cell across the bounded region', async ({ page }) => {
    await page.goto('/');
    await addChordMarker(page, 0, '0', 'maj');
    await startGenerator(page, 'Ostinato');
    await expect(page.locator('.generator-region')).toBeVisible();
    await expect(page.locator('.preview-note').first()).toBeVisible();
    // Default repeats (4) × a non-trivial cell should produce more onsets
    // than a single cell repetition alone could.
    const count = await page.locator('.preview-note').count();
    expect(count).toBeGreaterThan(2);
  });

  test('Motif generator: reroll with Contour locked keeps the pattern stable', async ({ page }) => {
    await page.goto('/');
    await startGenerator(page, 'Motif');
    await expect(page.locator('.preview-note').first()).toBeVisible();

    async function signature() {
      return (
        await page
          .locator('.preview-note')
          .evaluateAll((els) => els.map((el) => el.getAttribute('style') ?? ''))
      ).sort();
    }

    // Select the Motif module and switch its contour to "mixed" so reroll
    // has something seeded to actually vary. A <select>'s implicit
    // getByLabel name includes its currently-selected option text (e.g.
    // "Contour Arch"), so scope by the field wrapper instead of relying on
    // an exact label match.
    await page.locator('.module-card .module-select').first().click();
    await page.locator('.field', { hasText: 'Contour' }).locator('select').selectOption('mixed');
    await expect.poll(() => page.locator('.preview-note').count()).toBeGreaterThan(0);

    // Variation (a separate, unlocked "pitch" dimension per generators.md
    // §10's "Lock contour, reroll starting register") jitters pitches after
    // the first repeat by default — zero it so contour is the only thing
    // this test's reroll can possibly change.
    const variationSlider = page
      .locator('.field', { hasText: 'Variation' })
      .locator('input[type="range"]');
    await variationSlider.fill('0');
    await expect(page.locator('.range-value', { hasText: '0' })).toBeVisible();

    await page.getByRole('button', { name: 'Contour' }).click(); // lock chip
    const before = await signature();
    await page.locator('.inspector').getByRole('button', { name: 'Reroll' }).click();
    await expect.poll(signature).toEqual(before);
  });

  test('editing the chord track while a chord-track-sourced session is open marks it stale, and Recompute resolves it', async ({
    page,
  }) => {
    await page.goto('/');
    await addChordMarker(page, 0, '0', 'maj7');
    await startGenerator(page, 'Chords');
    await expect(page.locator('.inspector .status-ready')).toBeVisible();

    // Add a second, later chord marker while the session is open — a
    // declared chord-track dependency change (generators.md §6.2).
    await addChordMarker(page, 200, '7', '7');

    await expect(page.locator('.inspector .status-stale')).toBeVisible();
    await expect(page.locator('.stale-banner')).toBeVisible();

    // Scoped to the inspector — the contextual "Generator" ribbon tab also
    // exposes its own session-level Recompute action (generators.md §7.5).
    await page.locator('.inspector').getByRole('button', { name: 'Recompute' }).click();
    await expect(page.locator('.inspector .status-ready')).toBeVisible();
    await expect(page.locator('.stale-banner')).toHaveCount(0);
  });
});
