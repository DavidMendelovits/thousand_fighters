/**
 * exportCharacterToRuntime.js
 *
 * Higher-level function that reads a CMS draft + fighter pack data,
 * converts it to a runtime CharacterConfig, and writes the result to
 * the output directory.
 */

import { mkdir, readdir, copyFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertDraftToCharacterConfig } from './convertDraftToCharacterConfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Export a CMS character to a runtime-compatible directory.
 *
 * @param {{
 *   runtime: { repository: object, storage: object },
 *   characterId: string,
 *   outputDir?: string,
 *   copyAssets?: boolean,
 * }} params
 * @returns {Promise<{
 *   characterId: string,
 *   configPath: string,
 *   filesCopied: string[],
 *   config: object,
 * }>}
 */
export async function exportCharacterToRuntime({ runtime, characterId, outputDir, copyAssets = true }) {
  const { repository, storage } = runtime;
  const resolvedOutputDir = path.resolve(outputDir ?? path.join(REPO_ROOT, 'public', 'fighters'));
  const characterOutputDir = path.join(resolvedOutputDir, characterId);

  // Read draft from CMS
  const draft = await repository.getDraft(characterId);
  if (!draft) {
    throw new Error(`exportCharacterToRuntime: No draft found for character "${characterId}"`);
  }

  // Read fighter pack data
  const assetRoot = `characters/${characterId}/assets/fighter-pack`;
  let manifest = null;
  let frameData = null;

  try {
    manifest = await storage.getJson(`${assetRoot}/manifest.json`);
  } catch {
    // fighter pack may not have a manifest yet
  }

  try {
    frameData = await storage.getJson(`${assetRoot}/frameData.json`);
  } catch {
    // frame data may not exist yet
  }

  const config = convertDraftToCharacterConfig({ draft, frameData, manifest });

  // Ensure output directory exists
  await mkdir(characterOutputDir, { recursive: true });

  // Write config.json
  const configPath = path.join(characterOutputDir, 'config.json');
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  const filesCopied = [configPath];

  // Optionally copy fighter pack assets (sheets/, sprites/, projectiles/)
  if (copyAssets) {
    // Root-level pack files the assets index reads (manifest.json, frameData.json).
    for (const fileName of ['manifest.json', 'frameData.json', 'normalization-report.json']) {
      const key = `${assetRoot}/${fileName}`;
      try {
        if (!(await storage.exists(key))) continue;
        const destPath = path.join(characterOutputDir, fileName);
        await writeFile(destPath, await storage.getBytes(key));
        filesCopied.push(destPath);
      } catch {
        // optional file — skip
      }
    }

    const assetDirsToSync = ['sheets', 'sprites', 'projectiles'];
    for (const subDir of assetDirsToSync) {
      const storagePrefix = `${assetRoot}/${subDir}`;
      const destDir = path.join(characterOutputDir, subDir);
      const copied = await copyStorageAssets({ storage, storagePrefix, destDir });
      filesCopied.push(...copied);
    }

    // Generated SFX live outside the fighter pack, at characters/{id}/assets/sounds/
    const soundsCopied = await copyStorageAssets({
      storage,
      storagePrefix: `characters/${characterId}/assets/sounds`,
      destDir: path.join(characterOutputDir, 'sounds'),
    });
    filesCopied.push(...soundsCopied);
  }

  return {
    characterId,
    configPath,
    filesCopied,
    config,
  };
}

/**
 * Copy assets from CMS storage to a destination directory.
 *
 * @param {{ storage: object, storagePrefix: string, destDir: string }} params
 * @returns {Promise<string[]>} Paths of copied files
 */
async function copyStorageAssets({ storage, storagePrefix, destDir }) {
  const copied = [];

  let keys;
  try {
    keys = await storage.list(storagePrefix);
  } catch {
    // No assets at this prefix — skip
    return copied;
  }

  if (!keys?.length) return copied;

  await mkdir(destDir, { recursive: true });

  for (const key of keys) {
    // Derive the relative path under the destDir
    const relative = key.startsWith(storagePrefix + '/')
      ? key.slice(storagePrefix.length + 1)
      : path.basename(key);

    const destPath = path.join(destDir, relative);
    const destParent = path.dirname(destPath);
    await mkdir(destParent, { recursive: true });

    // If storage exposes a physical path, copy directly; otherwise read/write bytes
    if (typeof storage.absolutePath === 'function') {
      try {
        const srcPath = storage.absolutePath(key);
        await copyFile(srcPath, destPath);
        copied.push(destPath);
      } catch {
        // skip files that don't exist on disk
      }
    } else {
      try {
        const bytes = await storage.getBytes(key);
        await writeFile(destPath, bytes);
        copied.push(destPath);
      } catch {
        // skip assets that can't be read
      }
    }
  }

  return copied;
}
