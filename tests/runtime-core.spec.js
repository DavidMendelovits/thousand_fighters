import { test, expect } from '@playwright/test';

const origin = process.env.RUNTIME_BASE_URL || process.env.STUDIO_BASE_URL || 'http://127.0.0.1:5176';

for (const renderer of ['webgl', 'canvas']) {
  test(`${renderer}: Fight, Testbed and Gym retain rendering, factories and sound`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(mode => {
      window.__runtimeGames = [];
      let namespace;
      Object.defineProperty(globalThis, 'Phaser', {
        configurable: true,
        get: () => namespace,
        set(value) {
          namespace = value;
          const Game = value.Game;
          value.Game = class extends Game {
            constructor(config) {
              super({ ...config, type: mode === 'canvas' ? value.CANVAS : value.WEBGL });
              window.__runtimeGames.push(this);
            }
          };
        },
      });
    }, renderer);
    for (const path of ['/fight?p1=palimpsest&p2=palimpsest&cpu=off&touch=1', '/testbed?id=palimpsest', '/gym?id=palimpsest']) {
      await page.goto(`${origin}${path}`);
      await page.waitForFunction(() => window.__runtimeGames.some(game => game.scene.getScenes(true).some(scene => scene.children.length > 0)));
      const actual = await page.evaluate(async () => {
        const Phaser = window.Phaser;
        const game = window.__runtimeGames[0];
        const scene = game.scene.getScenes(true)[0];
        const shapes = [scene.add.rectangle(20, 20, 5, 5), scene.add.line(0, 0, 1, 1, 5, 5), scene.add.container()];
        shapes.forEach(shape => shape.destroy());
        // Decode and play a silent buffer through Phaser's actual WebAudio manager.
        let audioPlayed = false;
        if (game.sound.context) {
          await game.sound.context.resume();
          game.cache.audio.add('runtime-smoke', game.sound.context.createBuffer(1, 441, 44100));
          const sound = game.sound.add('runtime-smoke');
          audioPlayed = sound.play();
          sound.destroy();
        }
        return { renderer: game.renderer.type, expected: Phaser.CANVAS, physics: !!Phaser.Physics,
          clamp: Phaser.Math.Clamp(9, 0, 3), audioPlayed };
      });
      expect(actual.physics).toBe(false);
      expect(actual.clamp).toBe(3);
      expect(actual.audioPlayed).toBe(true);
      expect(actual.renderer === actual.expected).toBe(renderer === 'canvas');
      if (path.startsWith('/fight')) {
        const before = await page.evaluate(() => window.__stamptownDebug.snapshot().fighters[0].y);
        await page.getByRole('button', { name: 'JUMP', exact: true }).click();
        await page.waitForFunction(y => window.__stamptownDebug.snapshot().fighters[0].y < y, before);
        await page.getByRole('button', { name: 'Pause', exact: true }).click();
        await expect(page.getByRole('button', { name: 'RESUME', exact: true })).toBeVisible();
      }
      await expect(page.locator('canvas').first()).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
}
