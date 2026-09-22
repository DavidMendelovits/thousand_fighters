import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { historyFixture } from './helpers/historyFixture.js';

test('workbench previews a projectile and recovers a retained raw image without generation', async ({ page }) => {
  const fixture = await historyFixture();
  try {
    const { repository, storage } = fixture.runtime;
    const characterId = fixture.characterId;
    const root = `characters/${characterId}/assets/source`;
    const validKey = `${root}/valid-projectile.png`;
    const rawKey = `${root}/${characterId}_pending_projectile_raw_abcdef123456.png`;
    const sprite = await readFile('public/fighters/palimpsest/sprites/walk_forward/walk_forward_001.png');
    await storage.putBytes(validKey, sprite, { contentType: 'image/png' });
    await storage.putBytes(rawKey, sprite, { contentType: 'image/png' });
    await repository.saveDraft(characterId, {
      ...(await repository.getDraft(characterId)),
      projectiles: [
        { id: 'valid', animation: `${characterId}_valid`, sourceKey: validKey, width: 38, height: 30, speed: 7, lifetime: 72, velocity: { x: 7, y: 0 }, hitbox: { x: 0, y: 0, width: 38, height: 30, damage: 8, hitstun: 18, blockstun: 12, knockback: { x: 7, y: 0 }, level: 'mid' } },
        { id: 'pending', animation: `${characterId}_pending`, width: 82, height: 66, speed: 5, lifetime: 54, velocity: { x: 5, y: 0 }, hitbox: { x: 0, y: 0, width: 82, height: 66, damage: 5, hitstun: 14, blockstun: 8, knockback: { x: 5, y: 0 }, level: 'mid' } },
      ],
    });
    await page.goto(`${fixture.url}/roster/${characterId}?standalone=1`);
    await page.getByRole('tab', { name: 'Combos & effects' }).click();
    const valid = page.locator('[data-projectile-id="valid"]');
    const pending = page.locator('[data-projectile-id="pending"]');
    await expect(valid.locator('.kit-projectile-preview img')).toBeVisible();
    await expect(valid.getByRole('button', { name: 'Reprocess saved sprite · no API cost' })).toBeVisible();
    await expect(pending.getByRole('button', { name: 'Reprocess this saved source · no API cost' })).toBeVisible();
    await pending.getByRole('button', { name: 'Reprocess this saved source · no API cost' }).click();
    await expect.poll(async () => (await repository.getDraft(characterId)).projectiles.find(entity => entity.id === 'pending')?.sourceKey).toMatch(/pending_projectile_/);
    const updated = (await repository.getDraft(characterId)).projectiles.find(entity => entity.id === 'pending');
    expect(updated.sourceImageKey).toBe(rawKey);
    await expect(pending.locator('.kit-projectile-preview img')).toBeVisible();
    await valid.getByRole('spinbutton', { name: 'Hit X' }).fill('-19');
    await valid.getByRole('spinbutton', { name: 'Hit Y' }).fill('-15');
    await valid.getByRole('button', { name: 'Save numbers' }).click();
    await expect.poll(async () => (await repository.getDraft(characterId)).projectiles.find(entity => entity.id === 'valid')?.hitbox?.x).toBe(-19);
    expect((await repository.getDraft(characterId)).projectiles.find(entity => entity.id === 'valid')?.hitbox?.y).toBe(-15);
  } finally { await fixture.close(); }
});
