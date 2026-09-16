import { test, expect } from '@playwright/test';

const origin = process.env.ANIMATION_LAB_URL ?? 'http://127.0.0.1:5173';
const lab = `${origin}/animation-lab.html`;
const fixtureLab = `${lab}?clip=/animation-lab/acrobatics/clip.json`;

async function pause(page) {
  const button = page.getByRole('button', { name: 'Pause', exact: true });
  if (await button.count()) await button.click();
}

test('library, precise seeking, root motion, stage settings and downloads', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(fixtureLab);
  await expect(page.locator('#clip-title')).toHaveText('Orbit vault');
  await expect(page.locator('#source-badge')).toHaveText('PROCEDURAL DEMO');
  await pause(page);
  await page.getByRole('button', { name: 'Inversion at tick 38', exact: true }).click();
  await expect(page.locator('#tick-readout')).toHaveText('038');
  await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Play');
  const pixelHash = () => page.locator('canvas').evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 0;
    for (let i = 0; i < pixels.length; i++) hash = (Math.imul(hash, 31) + pixels[i]) | 0;
    return hash;
  });
  await expect.poll(pixelHash).not.toBe(0);
  const pixelBefore = await pixelHash();
  await page.getByRole('checkbox', { name: 'Apply root motion', exact: true }).check();
  await expect.poll(pixelHash).not.toBe(pixelBefore);
  await page.getByRole('button', { name: 'Next frame', exact: true }).click();
  await expect(page.locator('#tick-readout')).not.toHaveText('038');
  await page.getByRole('combobox', { name: 'Canvas zoom' }).selectOption('1');
  await page.getByRole('button', { name: 'Light background', exact: true }).click();
  await expect(page.locator('#stage')).toHaveAttribute('data-background', 'light');
  await page.getByRole('combobox', { name: 'Playback speed' }).selectOption('0.25');
  await expect(page.getByRole('link', { name: 'Download clip.json' })).toHaveAttribute('href', /acrobatics\/clip\.json$/);
  await page.getByRole('button', { name: 'Checker background', exact: true }).click();
  await page.getByRole('combobox', { name: 'Canvas zoom' }).selectOption('fit');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('animation-lab.png'), fullPage: true });
});

test('morph intent and three independently visible VFX layers', async ({ page }) => {
  await page.goto(`${lab}?clip=/animation-lab/morph/clip.json`);
  await expect(page.locator('#clip-title')).toHaveText('Sludge awakening');
  await pause(page);
  await expect(page.locator('#intent .enabled')).toContainText(['Body morphing', 'Scale changes']);
  await page.getByRole('button', { name: /Ion bloom/ }).click();
  await expect(page.locator('#clip-title')).toHaveText('Ion bloom');
  await pause(page);
  await expect(page.locator('#layers input')).toHaveCount(3);
  await page.getByRole('checkbox', { name: 'Anchor & sockets' }).uncheck();
  for (const input of await page.locator('#layers input').all()) await input.uncheck();
  const hasPixels = () => page.locator('canvas').evaluate(canvas => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return data.some((value, index) => index % 4 === 3 && value !== 0);
  });
  expect(await hasPixels()).toBe(false);
  await page.locator('#layers input[data-layer="body"]').check();
  expect(await hasPixels()).toBe(true);
});

test('URL loader rejects unsafe/broken clips and keeps the current clip usable', async ({ page }) => {
  await page.goto(fixtureLab);
  await expect(page.locator('#clip-title')).toHaveText('Orbit vault');
  await page.getByRole('button', { name: 'Open clip', exact: true }).click();
  await page.getByLabel('CLIP URL', { exact: true }).fill('javascript:alert(1)');
  await page.getByRole('button', { name: 'Load clip', exact: false }).click();
  await expect(page.getByRole('status')).toContainText('HTTP or HTTPS');
  await expect(page.locator('#clip-title')).toHaveText('Orbit vault');
  await page.route('**/bad-clip.json', route => route.fulfill({ json: { schemaVersion: 99 } }));
  await page.getByRole('button', { name: 'Open clip', exact: true }).click();
  await page.getByLabel('CLIP URL', { exact: true }).fill('/bad-clip.json');
  await page.getByRole('button', { name: 'Load clip', exact: false }).click();
  await expect(page.getByRole('status')).toContainText('schemaVersion');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
});

test('direct URL works without a gallery, exposes review warnings, and once playback stops', async ({ page, request }) => {
  const response = await request.get(`${origin}/animation-lab/acrobatics/clip.json`);
  const clip = await response.json();
  clip.playback = 'once';
  clip.provenance.method = 'generated-video';
  clip.qa.status = 'rejected';
  clip.qa.warnings = ['Test warning: inspect the inversion silhouette.'];
  await page.route('**/animation-lab/index.json', route => route.fulfill({ status: 404 }));
  await page.route(url => url.pathname === '/animation-lab/acrobatics/review-test.json', route => route.fulfill({ json: clip }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${lab}?clip=/animation-lab/acrobatics/review-test.json`);
  await expect(page.locator('#clip-title')).toHaveText('Orbit vault');
  await expect(page.locator('#source-badge')).toHaveText('GENERATED VIDEO');
  await expect(page.locator('#qa-status')).toContainText('REJECTED');
  await expect(page.locator('#qa-warnings')).toContainText('inspect the inversion');
  await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Play');
  await page.getByRole('combobox', { name: 'Playback speed' }).selectOption('2');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('#tick-readout')).toHaveText(String(clip.totalTicks - 1).padStart(3, '0'));
  await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Play');
});

test('live generated candidates render with provenance, review state and runtime exports', async ({ page, request }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const id of ['janitor_vault', 'janitor_morph']) {
    await page.goto(`${lab}?clip=/animation-lab/${id}/clip.json`);
    await expect(page.locator('#source-badge')).toHaveText('GENERATED VIDEO');
    await expect(page.locator('#qa-status')).toContainText('NEEDS HUMAN REVIEW');
    await pause(page);
    await expect(page.getByRole('checkbox', { name: 'Apply root motion' })).toBeDisabled();
    const fragment = page.getByRole('link', { name: 'Runtime fragment' });
    await expect(fragment).toBeVisible();
    const download = await request.get(await fragment.getAttribute('href'));
    expect(download.ok()).toBe(true);
    expect(await download.json()).toBeTruthy();
    expect(await page.locator('canvas').evaluate(canvas => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      return pixels.some((value, index) => index % 4 === 3 && value !== 0);
    })).toBe(true);
  }
  await expect(page.locator('#qa-warnings')).toContainText('Source boundary touched');
  expect(errors).toEqual([]);
});
