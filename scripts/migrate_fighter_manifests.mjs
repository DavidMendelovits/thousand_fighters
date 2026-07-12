#!/usr/bin/env node
/**
 * Migrate legacy fighter manifests (snake_case sheet_paths/sprite_paths/frame_counts,
 * absolute paths) in public/fighters to the canonical game format
 * (camelCase sheets/sprites/frameCounts, fighter-root-relative paths).
 *
 * Idempotent: canonical manifests are left untouched.
 */
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { normalizeManifest, hasLegacyManifestKeys } from '../cms/pipeline/manifestSchema.js';

const ROOT = resolve(import.meta.dirname, '..');
const FIGHTERS_DIR = join(ROOT, 'public', 'fighters');

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function findManifests(dir) {
  const results = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findManifests(full)));
    } else if (entry.name === 'manifest.json') {
      results.push(full);
    }
  }
  return results;
}

async function migrate(manifestPath) {
  const fighterRoot = manifestPath.slice(0, -'/manifest.json'.length);
  const id = relative(FIGHTERS_DIR, fighterRoot);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  if (!hasLegacyManifestKeys(manifest)) {
    console.log(`  ok        ${id}`);
    return false;
  }

  const normalized = normalizeManifest(manifest, { id });

  // Fill canonical file references the legacy format never carried.
  if (!normalized.frameData && (await exists(join(fighterRoot, 'frameData.json')))) {
    normalized.frameData = 'frameData.json';
  }
  if (!normalized.moveset && (await exists(join(fighterRoot, 'moveset.txt')))) {
    normalized.moveset = 'moveset.txt';
  }
  if (!normalized.artSource) normalized.artSource = 'image-gen';
  if (!normalized.projectiles) {
    const projectilesDir = join(fighterRoot, 'projectiles');
    if (await exists(projectilesDir)) {
      const files = (await readdir(projectilesDir)).filter((f) => f.endsWith('.png'));
      if (files.length) {
        normalized.projectiles = Object.fromEntries(
          files.sort().map((f) => [f.replace(/\.png$/, ''), `projectiles/${f}`]),
        );
      }
    }
  }

  // Stable key order for diff-friendly output.
  const ordered = {};
  for (const key of ['id', 'artSource', 'source', 'description', 'moveset', 'frameData', 'sheets', 'sprites', 'frameCounts', 'projectiles']) {
    if (key in normalized) ordered[key] = normalized[key];
  }
  for (const key of Object.keys(normalized)) {
    if (!(key in ordered)) ordered[key] = normalized[key];
  }

  await writeFile(manifestPath, `${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
  console.log(`  migrated  ${id}`);
  return true;
}

const manifests = await findManifests(FIGHTERS_DIR);
console.log(`Found ${manifests.length} manifests under public/fighters`);
let migrated = 0;
for (const manifestPath of manifests.sort()) {
  if (await migrate(manifestPath)) migrated += 1;
}
console.log(`${migrated} manifest(s) migrated, ${manifests.length - migrated} already canonical`);
