import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

// A semantic input probe: no wall-clock performance claim is made here.
// A held key must reach the fighter on the very next fixed simulation tick.
const browser = await chromium.launch();
const results = [];
try {
  for (const origin of (process.env.RUNTIME_DIAGNOSTIC_ORIGINS || 'http://127.0.0.1:5187,http://127.0.0.1:5186').split(',')) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(() => {
      let namespace;
      Object.defineProperty(globalThis, 'Phaser', {
        configurable: true, get: () => namespace,
        set(value) {
          namespace = value;
          const Game = value.Game;
          value.Game = class extends Game {
            constructor(config) { super(config); window.__diagnosticGame = this; }
          };
        },
      });
    });
    await page.goto(`${origin}/fight?p1=palimpsest&p2=palimpsest&cpu=off&training=1`);
    await page.waitForFunction(() => window.__stamptownDebug?.training && window.__diagnosticGame);
    const result = await page.evaluate(() => {
      const game = window.__diagnosticGame;
      const scene = game.scene.getScenes(true)[0];
      const d = window.__stamptownDebug;
      const samples = [];
      for (let i = 0; i < 30; i++) {
        d.training.reset(300, 600);
        const before = d.snapshot();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', keyCode: 68 }));
        const immediateKeyDown = scene.input.keyboard.addKey('D').isDown;
        d.training.step(1);
        const after = d.snapshot();
        window.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', code: 'KeyD', keyCode: 68 }));
        samples.push({ immediateKeyDown, tickDelta: after.frame - before.frame,
          xDelta: after.fighters[0].x - before.fighters[0].x,
          released: !scene.input.keyboard.addKey('D').isDown });
      }
      return {
        version: window.Phaser.VERSION,
        config: { forceSetTimeOut: game.loop.forceSetTimeOut, targetFps: game.loop.targetFps,
          fpsLimit: game.loop.fpsLimit, smoothStep: game.loop.smoothStep,
          rafUsesTimeout: game.loop.raf.isSetTimeOut, deltaSmoothingMax: game.loop.deltaSmoothingMax },
        defaultPlugins: window.Phaser.Plugins.DefaultPlugins,
        installedPlugins: Object.keys(scene.sys).filter(key => ['input', 'time', 'tweens', 'anims', 'cameras', 'load'].includes(key)).sort(),
        optionalLightsPlugin: !!scene.sys.lights,
        samples,
      };
    });
    assert.ok(result.samples.every(sample => sample.immediateKeyDown && sample.released && sample.tickDelta === 1 && sample.xDelta > 0));
    results.push({ origin, ...result });
    await context.close();
  }
  for (const result of results.slice(1)) {
    assert.deepEqual(result.config, results[0].config);
    assert.deepEqual(result.defaultPlugins, results[0].defaultPlugins);
    assert.deepEqual(result.installedPlugins, results[0].installedPlugins);
    assert.deepEqual(result.samples, results[0].samples);
  }
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
