#!/usr/bin/env node
/**
 * backfill_projectiles.mjs
 *
 * One-off backfill: find all existing raw projectile PNGs under each
 * character's assets/source directory (the _projectile.png files), run
 * normalize_projectile.py over each, and write the normalized (transparent,
 * cropped, capped) bytes BACK to the source path in place.
 *
 * Idempotent: if the image already has an alpha channel and its longest side
 * is already ≤ 256px it is re-processed (safe) — the output is deterministic.
 *
 * The orchestrator runs this, then re-runs export_cms_character.mjs (or
 * create_roster.mjs with idempotency flags) to copy the fixed projectile
 * sources to public/fighters/.
 *
 * Usage:
 *   node scripts/backfill_projectiles.mjs [--dry-run]
 */

import { execFile } from 'node:child_process';
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CMS_DATA = path.join(REPO_ROOT, 'cms-data', 'characters');
const NORMALIZE_SCRIPT = path.join(REPO_ROOT, 'scripts', 'normalize_projectile.py');

const DRY_RUN = process.argv.includes('--dry-run');

async function findProjectilePngs(root) {
  const results = [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...await findProjectilePngs(full));
    } else if (entry.isFile() && entry.name.endsWith('_projectile.png')) {
      results.push(full);
    }
  }
  return results;
}

async function normalizeInPlace(filePath) {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'tf-backfill-proj-'));
  try {
    const rawBytes = await readFile(filePath);
    const rawPath = path.join(tmpDir, 'raw.png');
    const normPath = path.join(tmpDir, 'norm.png');
    await writeFile(rawPath, rawBytes);

    const { stdout } = await execFileAsync(
      'python3',
      [NORMALIZE_SCRIPT, rawPath, normPath],
      { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
    );
    const result = JSON.parse(stdout);

    if (!DRY_RUN) {
      const normalizedBytes = await readFile(normPath);
      await writeFile(filePath, normalizedBytes);
    }

    return result;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  console.log(`Backfilling projectile sprites in ${CMS_DATA}${DRY_RUN ? ' (DRY RUN — no files written)' : ''}`);

  const projectiles = await findProjectilePngs(CMS_DATA);
  if (projectiles.length === 0) {
    console.log('No projectile PNGs found.');
    return;
  }

  console.log(`Found ${projectiles.length} projectile PNG(s):\n`);

  let ok = 0;
  let failed = 0;
  for (const filePath of projectiles) {
    const rel = path.relative(REPO_ROOT, filePath);
    try {
      const result = await normalizeInPlace(filePath);
      const [iw, ih] = result.inputSize;
      const [ow, oh] = result.outputSize;
      const status = DRY_RUN ? '[dry-run]' : '[written]';
      console.log(`  ${status} ${rel}: ${iw}x${ih} → ${ow}x${oh} (alpha=${result.hasAlpha})`);
      ok++;
    } catch (err) {
      console.error(`  [FAILED]  ${rel}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. ${ok} normalized, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
