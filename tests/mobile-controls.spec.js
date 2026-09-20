import { test, expect } from '@playwright/test';
test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
const origin = 'http://127.0.0.1:5174';
async function openArena(page, training = true) {
  await page.goto(`${origin}/fight.html?p1=brine&p2=meridian&cpu=off&touch=1${training ? '&training=1' : ''}`);
  await page.waitForFunction(() => window.__stamptownDebug?.snapshot);
  if (training) await page.evaluate(() => window.__stamptownDebug.training.reset(300, 355));
}
const step = (page, frames = 1) => page.evaluate(n => window.__stamptownDebug.training.step(n), frames);
const fighter = page => page.evaluate(() => window.__stamptownDebug.snapshot().fighters[0]);

test('simultaneous real touch pad + special triggers the alternate move and releases cleanly', async ({ page, context }) => {
  await openArena(page);
  const cdp = await context.newCDPSession(page);
  const pad = await page.getByRole('application', { name: 'Movement pad' }).boundingBox();
  const attack = await page.getByRole('button', { name: 'SPECIAL', exact: true }).boundingBox();
  const points = [{ id: 1, x: pad.x + pad.width / 2, y: pad.y + pad.height * .85 }, { id: 2, x: attack.x + attack.width / 2, y: attack.y + attack.height / 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
  await step(page);
  expect((await fighter(page)).move).toBe('ink_bell');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await step(page, 100);
  expect((await fighter(page)).state).toBe('idle');
  expect(await page.locator('.is-pressed').count()).toBe(0);
});

test('one-finger grab catches an opponent; jump button produces airborne movement', async ({ page }) => {
  await openArena(page);
  await page.getByRole('button', { name: 'GRAB', exact: true }).tap();
  await step(page);
  expect((await fighter(page)).move).toBe('clinch');
  const caught = await page.evaluate(() => {
    const d = window.__stamptownDebug;
    return Array.from({ length: 25 }, () => { d.training.step(1); return d.snapshot().fighters[1].state; });
  });
  expect(caught).toContain('grabbed');
  await page.evaluate(() => window.__stamptownDebug.training.reset(300, 600));
  await page.getByRole('button', { name: 'JUMP', exact: true }).tap();
  await step(page);
  expect((await fighter(page)).state).toBe('airborne');
});

test('settings pause safely, persist, and keep controls and arena inside phone bounds', async ({ page }, info) => {
  await openArena(page, false);
  await page.getByRole('button', { name: 'Control settings' }).tap();
  expect(await page.evaluate(() => window.__stamptownDebug.snapshot().paused)).toBe(true);
  await page.getByLabel('Layout', { exact: true }).selectOption('left');
  await page.getByLabel('Button size').selectOption('large');
  await page.getByLabel('Contrast').selectOption('high');
  await page.getByRole('button', { name: 'SAVE & RETURN' }).tap();
  expect(await page.evaluate(() => window.__stamptownDebug.snapshot().paused)).toBe(false);
  await page.reload();
  await page.waitForFunction(() => window.__stamptownDebug?.snapshot);
  await expect(page.locator('#game-controls')).toHaveAttribute('data-hand', 'left');
  await expect(page.locator('#game-controls')).toHaveAttribute('data-size', 'large');
  for (const viewport of [{ width: 844, height: 390 }, { width: 390, height: 844 }, { width: 667, height: 375 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => {
      const c = document.querySelector('canvas').getBoundingClientRect();
      const arena = document.querySelector('#game-canvas-wrap').getBoundingClientRect();
      return c.top >= arena.top - 1 && c.bottom <= arena.bottom + 1 && c.left >= -1 && c.right <= innerWidth + 1;
    })).toBe(true);
    for (const b of await page.locator('#game-controls > div button').all()) {
      const box = await b.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    }
    await page.screenshot({ path: info.outputPath(`touch-${viewport.width}.png`) });
  }
  await expect(page.locator('.control-telemetry')).toHaveCount(0);
});

test('native suspend clears a held action and requires explicit resume', async ({ page }) => {
  await openArena(page, false);
  const pad = await page.getByRole('application', { name: 'Movement pad' }).boundingBox();
  await page.mouse.move(pad.x + pad.width * .85, pad.y + pad.height / 2);
  await page.mouse.down();
  await page.evaluate(() => window.dispatchEvent(new Event('tf:suspend')));
  expect(await page.evaluate(() => window.__stamptownDebug.snapshot().paused)).toBe(true);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Pause', exact: true }).tap();
  await expect.poll(async () => (await fighter(page)).state).toBe('idle');
});

test('phone-sized pause menu can restart and resume without keyboard input', async ({ page }) => {
  await openArena(page, false);
  await page.getByRole('button', { name: 'Pause', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'RESTART ROUND' })).toBeVisible();
  await page.getByRole('button', { name: 'RESTART ROUND' }).tap();
  await expect.poll(() => page.evaluate(() => window.__stamptownDebug.snapshot().paused)).toBe(false);
  await page.getByRole('button', { name: 'Pause', exact: true }).tap();
  const resume = page.getByRole('button', { name: 'RESUME', exact: true });
  const box = await resume.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  await resume.tap();
  await expect.poll(() => page.evaluate(() => window.__stamptownDebug.snapshot().paused)).toBe(false);
});
