import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { cpus, loadavg, platform, release } from 'node:os';

// Run against a production preview, on an otherwise idle machine. Browser phone
// emulation measures layout/input only; it is never physical-device evidence.
const origin = process.env.RUNTIME_BASE_URL || 'http://127.0.0.1:5186';
const samples = Number(process.env.RUNTIME_SAMPLES || 5);
if (!Number.isInteger(samples) || samples < 1) throw new Error('RUNTIME_SAMPLES must be a positive integer');
if (process.env.RUNTIME_BASELINE_URL === origin) throw new Error('Baseline and candidate origins must differ');
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const cpuTotals = () => cpus().reduce((sum, cpu) => ({ idle: sum.idle + cpu.times.idle,
  total: sum.total + Object.values(cpu.times).reduce((total, time) => total + time, 0) }), { idle: 0, total: 0 });
const browser = await chromium.launch({ headless: process.env.HEADED !== '1' });
const runs = [];
const baselineRuns = [];
try {
  for (let run = 0; run < samples; run++) {
    // Alternate baseline/candidate on the same host to reduce ordering effects.
    for (const target of [process.env.RUNTIME_BASELINE_URL, origin].filter(Boolean)) {
    const cpuBefore = cpuTotals();
    const loadBefore = loadavg();
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      let namespace;
      Object.defineProperty(globalThis, 'Phaser', {
        configurable: true, get: () => namespace,
        set(value) {
          namespace = value;
          const Game = value.Game;
          value.Game = class extends Game {
            constructor(config) { super(config); window.__benchmarkGame = this; }
          };
        },
      });
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${target}/fight?p1=palimpsest&p2=palimpsest&cpu=off`);
    await page.waitForFunction(() => window.__stamptownDebug?.snapshot().fighters.length === 2);
    const startupMs = await page.evaluate(() => performance.now());
    const input = await page.evaluate(async () => {
      const d = window.__stamptownDebug;
      const game = window.__benchmarkGame;
      // Observe the engine's completed render, not a separate RAF callback:
      // an independently scheduled RAF can run before the engine and report
      // movement one browser frame late. Start just after a simulation tick.
      const readyFrame = d.snapshot().frame;
      await new Promise(resolve => {
        const ready = () => {
          if (d.snapshot().frame > readyFrame) { game.events.off('postrender', ready); resolve(); }
        };
        game.events.on('postrender', ready);
      });
      const before = d.snapshot();
      const initial = before.fighters[0].x;
      const scene = game.scene.getScenes(true)[0];
      const accumulatorBeforeInput = scene.gameLoop.accumulator;
      const started = performance.now();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', keyCode: 68, bubbles: true }));
      const immediateKeyDown = scene.input.keyboard.addKey('D').isDown;
      let observedFrames = 0;
      await new Promise((resolve, reject) => {
        const tick = () => {
          observedFrames++;
          if (d.snapshot().fighters[0].x !== initial) { game.events.off('postrender', tick); resolve(); }
          else if (performance.now() - started > 2000) { game.events.off('postrender', tick); reject(new Error('Movement input did not reach fighter')); }
        };
        game.events.on('postrender', tick);
      });
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', code: 'KeyD', keyCode: 68, bubbles: true }));
      return { latencyMs: performance.now() - started, simulationTicks: d.snapshot().frame - before.frame,
        observedFrames, immediateKeyDown, accumulatorBeforeInput };
    });
    const frameMs = await page.evaluate(async () => {
      const frames = [];
      let previous;
      await new Promise(resolve => {
        const tick = now => {
          if (previous !== undefined) frames.push(now - previous);
          previous = now;
          // Exercise real move rendering while the normal game loop runs.
          if (frames.length % 45 === 0) {
            const d = window.__stamptownDebug;
            const ids = d.snapshot().fighters[0].moveIds;
            d.startMove(1, ids[Math.floor(frames.length / 45) % ids.length]);
          }
          if (frames.length >= 180) resolve(); else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return frames;
    });
    const cpuAfter = cpuTotals();
    const totalCpuDelta = cpuAfter.total - cpuBefore.total;
    const systemCpuBusyFraction = totalCpuDelta > 0 ? 1 - (cpuAfter.idle - cpuBefore.idle) / totalCpuDelta : null;
    (target === origin ? runs : baselineRuns).push({ startupMs, inputMs: input.latencyMs, input, p95FrameMs: percentile(frameMs, .95),
      host: { loadBefore, loadAfter: loadavg(), systemCpuBusyFraction },
      medianFrameMs: percentile(frameMs, .5), errors });
    await context.close();
    }
  }
} finally { await browser.close(); }
const report = {
  measurementVersion: 2,
  host: { platform: platform(), release: release(), logicalCpus: cpus().length },
  measuredAt: new Date().toISOString(), origin, browser: browser.version(), device: 'desktop Chromium (headless unless HEADED=1)',
  physicalPhoneVerified: false, runs,
  medianStartupMs: percentile(runs.map(run => run.startupMs), .5),
  medianInputMs: percentile(runs.map(run => run.inputMs), .5),
  p95FrameMs: percentile(runs.map(run => run.p95FrameMs), .95),
};
if (process.env.RUNTIME_BASELINE) {
  const baseline = JSON.parse(await readFile(process.env.RUNTIME_BASELINE, 'utf8'));
  if (baseline.measurementVersion !== report.measurementVersion) throw new Error('Recapture baseline using the same benchmark measurement version');
  report.regressions = {
    startup: report.medianStartupMs / baseline.medianStartupMs - 1,
    input: report.medianInputMs / baseline.medianInputMs - 1,
  };
}
if (baselineRuns.length) {
  report.baseline = {
    origin: process.env.RUNTIME_BASELINE_URL, runs: baselineRuns,
    medianStartupMs: percentile(baselineRuns.map(run => run.startupMs), .5),
    medianInputMs: percentile(baselineRuns.map(run => run.inputMs), .5),
    p95FrameMs: percentile(baselineRuns.map(run => run.p95FrameMs), .95),
  };
  report.regressions = {
    startup: report.medianStartupMs / report.baseline.medianStartupMs - 1,
    input: report.medianInputMs / report.baseline.medianInputMs - 1,
  };
}
if (process.env.RUNTIME_REPORT) await writeFile(process.env.RUNTIME_REPORT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (report.p95FrameMs > 20 || runs.some(run => run.errors.length)
  || Object.values(report.regressions || {}).some(delta => delta > .05)) process.exitCode = 1;
