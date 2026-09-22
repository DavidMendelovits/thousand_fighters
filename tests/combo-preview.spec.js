import {test,expect} from '@playwright/test';

test.skip(!process.env.STUDIO_BASE_URL,'Requires the real game and CMS.');
test('Palimpsest sequence plays its exclusive follow-ups and reports completion',async({page})=>{
  await page.goto(`${process.env.STUDIO_BASE_URL}/testbed?id=palimpsest`);
  const route=page.locator('.combo-route').filter({hasText:/living.margin/i});
  await expect(route).toBeVisible();
  await route.locator('[data-sequence]').click();
  await expect(page.locator('#combo-preview-status')).toContainText('Sequence complete · 3 moves',{timeout:15000});
  await expect(page.locator('#combo-preview-status')).toContainText('not proof of an unbroken combo');
  await expect(page.locator('#moves button.move[title*="combo_living_margin"]')).toHaveCount(0);
});

test('hit-confirm route uses legal cancels and refuses a whiff',async({page})=>{
  await page.goto(`${process.env.STUDIO_BASE_URL}/testbed?id=palimpsest`);
  const route=page.locator('.combo-route').filter({hasText:/living.margin/i});
  await expect(route.locator('[data-confirm]')).toBeEnabled();
  const distance=page.locator('#distance');
  await distance.fill('60');await distance.dispatchEvent('input');
  await route.locator('[data-confirm]').click();
  await expect(page.locator('#combo-preview-status')).toContainText('Sequence complete · 3 moves',{timeout:15000});
  await expect(page.locator('#combo-preview-status')).toContainText('Engine cancel rules respected.');
  await distance.fill('420');await distance.dispatchEvent('input');
  await route.locator('[data-confirm]').click();
  await expect(page.locator('#combo-preview-status')).toContainText('no legal cancel',{timeout:15000});
});
