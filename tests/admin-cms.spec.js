import { expect, test } from '@playwright/test';

test.describe('CMS admin platform', () => {
  test('surfaces pipeline health, grouped animations, and sprite upload', async ({ page, request }, testInfo) => {
    const characterId = `pw_${testInfo.project.name}_${Date.now()}`
      .replace(/[^a-z0-9_-]+/gi, '_')
      .toLowerCase();

    const draftResponse = await request.post('/api/tools/create_character_draft', {
      data: {
        characterId,
        brief: 'A Playwright validation fighter with visible grouped move animations and a projectile upload.',
      },
    });
    expect(draftResponse.ok()).toBeTruthy();

    const sheetResponse = await request.post('/api/tools/generate_sprite_sheet', {
      data: {
        characterId,
        prompt: '5x6 fighter sheet, full-body frames, clean gutters, magenta background.',
      },
    });
    expect(sheetResponse.ok()).toBeTruthy();
    const sheet = await sheetResponse.json();

    const normalizeResponse = await request.post('/api/tools/normalize_sprite_pack', {
      data: {
        characterId,
        sourceAssetKey: sheet.result.asset.key,
      },
    });
    expect(normalizeResponse.ok()).toBeTruthy();

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Character CMS' })).toBeVisible();
    await expect(page.locator('#system-status')).toContainText('thousand-fighters-cms');
    await expect(page.locator('.health-badge').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pipeline' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Add Sprite Asset' })).toBeVisible();

    await page.locator(`[data-character-id="${characterId}"]`).click();
    const workbench = page.locator('#character-workbench');
    await expect(workbench).toContainText('Base / States');
    await expect(workbench).toContainText('Punch Moves');
    await expect(workbench).toContainText('Kick');
    await expect(workbench).toContainText('Animation');
    await expect(workbench.locator('[data-animation-player]').first()).toBeVisible();
    await expect(workbench.locator('.frame-strip img').first()).toBeVisible();

    const firstSprite = await request.get(`/api/assets/characters/${characterId}/assets/fighter-pack/sprites/base/base_001.png`);
    expect(firstSprite.ok()).toBeTruthy();
    const spriteBytes = await firstSprite.body();

    await page.locator('#asset-kind').selectOption('projectile');
    await page.locator('#asset-file').setInputFiles({
      name: 'playwright_projectile.png',
      mimeType: 'image/png',
      buffer: spriteBytes,
    });
    await expect(page.locator('#asset-path')).toHaveValue('projectiles/playwright_projectile.png');
    await page.getByRole('button', { name: 'Add Sprite' }).click();
    await expect(page.locator('#run-log')).toContainText('Added projectiles/playwright_projectile.png');
    await expect(workbench).toContainText('Projectiles / Effects');
    await expect(workbench).toContainText('playwright_projectile');
  });
});
