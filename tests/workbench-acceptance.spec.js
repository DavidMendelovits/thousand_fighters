import {test, expect} from '@playwright/test';
const origin = 'http://127.0.0.1:5173';

test('published workbench fighter jumps and its authored projectile hits through keyboard input', async ({page}) => {
  await page.goto(`${origin}/?p1=latch&p2=brine&cpu=off`);
  await page.waitForFunction(() => window.__stamptownDebug?.snapshot);
  expect(await page.evaluate(() => window.__stamptownDebug.snapshot().fighters[0].id)).toBe('latch');
  await page.keyboard.press('w');
  await page.waitForFunction(() => window.__stamptownDebug.snapshot().fighters[0].y < 360);
  await page.waitForFunction(() => window.__stamptownDebug.snapshot().fighters[0].y === 390);
  await page.keyboard.press('s');
  await page.waitForTimeout(30);
  await page.keyboard.press('h');
  await page.waitForFunction(() => window.__stamptownDebug.snapshot().projectiles.some(p => p.id === 'spare_key_projectile' && p.y === 325));
  await page.waitForFunction(() => window.__stamptownDebug.snapshot().fighters[1].health < 1080);
});

test('restart does not duplicate pause and CPU keyboard handlers', async ({page}) => {
  await page.goto(`${origin}/?p1=latch&p2=brine&cpu=off`);
  await page.waitForFunction(() => window.__stamptownDebug?.snapshot);
  for(let i=0;i<3;i++) {
    const previousSceneApi = await page.evaluateHandle(() => window.__stamptownDebug);
    await page.keyboard.press('r', {delay:40});
    await page.waitForFunction(previous => window.__stamptownDebug !== previous, previousSceneApi);
    await previousSceneApi.dispose();
    await page.waitForTimeout(60);
    await page.keyboard.press('p', {delay:40});
    await page.waitForFunction(() => window.__stamptownDebug.snapshot().paused);
    await page.waitForTimeout(50);
    await page.keyboard.press('p', {delay:40});
    await page.waitForFunction(() => !window.__stamptownDebug.snapshot().paused);
    await page.waitForTimeout(60);
    const cpu = await page.evaluate(() => window.__stamptownDebug.snapshot().cpu);
    await page.keyboard.press('F2', {delay:40});
    await page.waitForFunction(before => window.__stamptownDebug.snapshot().cpu !== before, cpu);
  }
});
