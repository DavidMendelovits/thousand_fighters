import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createImageGeneratorAdapter } from '../cms/pipeline/adapters/createImageGeneratorAdapter.js';

const options = parseArgs(process.argv.slice(2));
const providers = (options.providers ?? process.env.FAST_IMAGE_BENCHMARK_PROVIDERS ?? 'minimax-image,bfl-klein,fal')
  .split(',').map((value) => value.trim()).filter(Boolean);
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputDirectory = path.resolve(options.output ?? `artifacts/fast-image-benchmark/${timestamp}`);
const referenceImages = options.reference
  ? [{
      base64: (await readFile(path.resolve(options.reference))).toString('base64'),
      contentType: contentTypeFor(options.reference),
      sourceKey: path.resolve(options.reference),
    }]
  : [];
const prompt = options.prompt ?? 'A distinctive fighting-game character performs one crisp straight punch.';
const moveId = options.move ?? 'punch';
const task = options.profile === 'wide' ? 'fighter-2x3-grid' : 'fighter-1x6-row';

await mkdir(outputDirectory, { recursive: true });
const results = [];
for (const provider of providers) {
  const adapter = createImageGeneratorAdapter({ provider });
  const health = await adapter.healthCheck();
  if (health.status === 'error') {
    results.push({ provider, model: adapter.model ?? null, status: 'skipped', error: health.message });
    console.log(`SKIP ${provider}: ${health.message}`);
    continue;
  }
  const startedAt = performance.now();
  try {
    const generated = await adapter.generateImage({ task, prompt, moveId, referenceImages });
    const wallTimeMs = Math.round(performance.now() - startedAt);
    const filename = `${provider.replace(/[^a-z0-9_-]+/gi, '-')}.png`;
    await writeFile(path.join(outputDirectory, filename), generated.bytes ?? Buffer.from(generated.base64, 'base64'));
    results.push({
      provider,
      model: generated.model ?? adapter.model ?? null,
      status: 'ok',
      wallTimeMs,
      generationMs: generated.generationMs ?? null,
      postprocessMs: generated.postprocessMs ?? null,
      frameTimings: generated.frameTimings ?? null,
      estimatedCostUsd: generated.estimatedCostUsd ?? null,
      output: filename,
    });
    console.log(`OK   ${provider}: ${(wallTimeMs / 1000).toFixed(2)}s${generated.estimatedCostUsd == null ? '' : `, est. $${generated.estimatedCostUsd.toFixed(4)}`}`);
  } catch (error) {
    results.push({ provider, model: adapter.model ?? null, status: 'error', wallTimeMs: Math.round(performance.now() - startedAt), error: error.message });
    console.error(`FAIL ${provider}: ${error.message}`);
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  task,
  moveId,
  prompt,
  referenceCount: referenceImages.length,
  providers,
  results,
};
await writeFile(path.join(outputDirectory, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(path.join(outputDirectory, 'README.md'), markdownReport(report));
console.log(`\nBenchmark written to ${outputDirectory}`);
if (!results.some((result) => result.status === 'ok')) process.exitCode = 1;

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) continue;
    const [name, inlineValue] = token.slice(2).split('=', 2);
    parsed[name] = inlineValue ?? args[++index];
  }
  return parsed;
}

function contentTypeFor(filename) {
  if (/\.webp$/i.test(filename)) return 'image/webp';
  if (/\.jpe?g$/i.test(filename)) return 'image/jpeg';
  return 'image/png';
}

function markdownReport(report) {
  const rows = report.results.map((result) =>
    `| ${result.provider} | ${result.model ?? '—'} | ${result.status} | ${result.wallTimeMs == null ? '—' : `${(result.wallTimeMs / 1000).toFixed(2)}s`} | ${result.postprocessMs == null ? '—' : `${result.postprocessMs}ms`} | ${result.estimatedCostUsd == null ? '—' : `$${result.estimatedCostUsd.toFixed(4)}`} | ${result.output ?? result.error ?? '—'} |`,
  );
  return `# Fast image benchmark\n\nGenerated ${report.generatedAt}. Six frame calls run concurrently; wall time includes provider generation, downloads, and local sheet composition.\n\n| Provider | Model | Status | Wall time | Local compose | Est. cost | Output / error |\n| --- | --- | --- | ---: | ---: | ---: | --- |\n${rows.join('\n')}\n`;
}
