import { test, expect } from '@playwright/test';
import { historyFixture } from './helpers/historyFixture.js';

test('checkpoint, compare and restore frozen assets from the real history interface', async ({ page }) => {
  const fixture = await historyFixture();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`${fixture.url}/roster/${fixture.characterId}?standalone=1`);
    await page.getByRole('tab', { name: 'History', exact: true }).click();
    await expect(page.locator('.history-storage')).toContainText('Local archive only');
    await page.getByRole('textbox', { name: 'Checkpoint name' }).fill('QA original');
    await page.getByRole('button', { name: 'Save checkpoint', exact: true }).click();
    await expect(page.locator('.history-status')).toHaveText('Checkpoint saved with frozen assets.');
    const original = (await fixture.runtime.repository.listVersions(fixture.characterId)).find(v => v.label === 'QA original');
    const before = await fixture.runtime.storage.getBytes(`${fixture.pack}/sprites/base/base_001.png`);
    // Simulate a subsequent generation replacing the working sprite and draft.
    await fixture.runtime.storage.putBytes(`${fixture.pack}/sprites/base/base_001.png`, Buffer.from('new-generation'), { contentType: 'image/png' });
    await fixture.runtime.repository.saveDraft(fixture.characterId, { ...await fixture.runtime.repository.getDraft(fixture.characterId), displayName: 'Changed fighter' });
    await page.getByRole('textbox', { name: 'Checkpoint name' }).fill('QA changed');
    await page.getByRole('button', { name: 'Save checkpoint', exact: true }).click();
    await expect(page.locator('.history-status')).toHaveText('Checkpoint saved with frozen assets.');
    await page.getByRole('button', { name: 'Compare checkpoints' }).click();
    await expect(page.locator('.history-comparison')).toContainText('1 changed assets');
    await expect(page.locator('.history-comparison')).toContainText('displayName');
    page.once('dialog', dialog => dialog.accept());
    await page.locator(`[data-version="${original.versionId}"]`).click();
    await expect(page.getByRole('heading', { name: 'History QA fighter', exact: true })).toBeVisible();
    await expect(page.locator('.history-versions')).toContainText('Before restoring');
    const restored = await fixture.runtime.repository.getDraft(fixture.characterId);
    expect(restored.assets.rootKey).toContain('/assets/revisions/');
    expect(await fixture.runtime.storage.getBytes(`${restored.assets.rootKey}/sprites/base/base_001.png`)).toEqual(before);
    await expect(page.locator('.history-status')).not.toContainText('failed');
    const panel = page.locator('#character-history');
    await panel.scrollIntoViewIfNeeded();
    expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
    await page.screenshot({ path: test.info().outputPath('history-restored.png') });
  } finally { await fixture.close(); }
});
