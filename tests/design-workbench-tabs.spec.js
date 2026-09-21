import { test, expect } from '@playwright/test';

test.skip(!process.env.STUDIO_BASE_URL, 'Set STUDIO_BASE_URL to a running full studio.');

test('workspace tabs expose their panels and support keyboard navigation', async ({ page }) => {
  await page.goto(`${process.env.STUDIO_BASE_URL}/workbench?character=palimpsest`);
  const cms = page.frameLocator('#cms-frame');
  const tabs = cms.locator('.workbench-sections [role="tab"]');

  await expect(cms.locator('.workbench-sections')).toHaveAttribute('role', 'tablist');
  await expect(tabs).toHaveCount(6);
  expect(await tabs.evaluateAll(nodes => nodes.filter(node => !document.getElementById(node.getAttribute('aria-controls'))).map(node => node.id))).toEqual([]);

  const motion = cms.locator('#studio-tab-motion');
  await expect(motion).toHaveAttribute('aria-selected', 'true');
  await motion.focus();
  await motion.press('ArrowRight');
  await expect(cms.locator('#studio-tab-combos')).toHaveAttribute('aria-selected', 'true');
  await expect(cms.locator('#studio-panel-combos')).toBeVisible();
});
