#!/usr/bin/env node
/**
 * export_cms_character.mjs
 *
 * CLI script to export a CMS character draft to a runtime-compatible
 * CharacterConfig in public/fighters/<characterId>/config.json.
 *
 * Usage:
 *   node scripts/export_cms_character.mjs <characterId> [outputDir]
 *
 * Examples:
 *   node scripts/export_cms_character.mjs my_fighter
 *   node scripts/export_cms_character.mjs my_fighter ./dist/fighters
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalCmsRuntime } from '../cms/runtime/createLocalCmsRuntime.js';
import { exportCharacterToRuntime } from '../cms/export/exportCharacterToRuntime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const characterId = process.argv[2];
if (!characterId) {
  console.error('Usage: node scripts/export_cms_character.mjs <characterId> [outputDir]');
  console.error('');
  console.error('Examples:');
  console.error('  node scripts/export_cms_character.mjs my_fighter');
  console.error('  node scripts/export_cms_character.mjs my_fighter ./dist/fighters');
  process.exit(1);
}

const outputDir = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(REPO_ROOT, 'public', 'fighters');

console.log(`Exporting CMS character "${characterId}" to ${outputDir}/${characterId}/config.json...`);

const runtime = createLocalCmsRuntime();

try {
  const result = await exportCharacterToRuntime({
    runtime,
    characterId,
    outputDir,
    copyAssets: true,
  });

  console.log(`Exported ${characterId}:`);
  console.log(`  Config: ${result.configPath}`);
  console.log(`  Assets copied: ${result.filesCopied.length - 1}`);
  console.log('');
  console.log('CharacterConfig summary:');
  console.log(`  displayName: ${result.config.displayName}`);
  console.log(`  maxHealth: ${result.config.maxHealth}`);
  console.log(`  moves: ${result.config.moves.length}`);
  console.log('');
  console.log('Done.');
} catch (err) {
  console.error(`Export failed: ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
}
