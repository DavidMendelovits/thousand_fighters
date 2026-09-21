import { test, expect } from '@playwright/test';

test.skip(!process.env.STUDIO_BASE_URL, 'Set STUDIO_BASE_URL to a running full studio.');

test('history keeps recent lineage visible and progressively discloses the archive', async ({ page }) => {
  await page.goto(`${process.env.STUDIO_BASE_URL}/workbench?character=palimpsest`);
  const cms = page.frameLocator('#cms-frame');

  await cms.locator('[data-studio-section="history"]').click();
  await expect(cms.locator('.history-versions > .history-card')).toHaveCount(8);
  await expect(cms.locator('.history-versions .history-more > summary')).toContainText('older checkpoints');
  await expect(cms.locator('.history-events > .history-card')).toHaveCount(12);
  await expect(cms.locator('.history-events .history-more > summary')).toContainText('older events');
});
