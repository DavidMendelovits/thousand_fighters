#!/usr/bin/env node
import { readdir, readFile, stat } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC = join(ROOT, 'public');
const FIGHTERS_DIR = join(PUBLIC, 'fighters');
const ARENAS_DIR = join(PUBLIC, 'arenas');
const AUDIO_DIR = join(PUBLIC, 'audio');
const OUTPUT = join(PUBLIC, 'assets-index.json');

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch { return null; }
}

async function listDir(path) {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch { return []; }
}

async function listFiles(path, extensions) {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && extensions.some((ext) => e.name.endsWith(ext)))
      .map((e) => e.name);
  } catch { return []; }
}

async function indexFighter(fighterId, dir) {
  const manifest = await readJson(join(dir, 'manifest.json'));
  const frameData = await readJson(join(dir, 'frameData.json'));

  const entry = {
    displayName: manifest?.id ?? fighterId,
    basePath: `/fighters/${fighterId}`,
    artSource: manifest?.artSource ?? null,
    sheets: manifest?.sheets ?? {},
    frameCounts: {},
    frameData: frameData?.frames ?? null,
    sprites: manifest?.sprites ?? {},
    projectiles: manifest?.projectiles ?? {},
    sounds: {},
  };

  if (frameData?.frames) {
    for (const [sheetId, frames] of Object.entries(frameData.frames)) {
      entry.frameCounts[sheetId] = Array.isArray(frames) ? frames.length : 0;
    }
  } else if (manifest?.sprites) {
    for (const [sheetId, sprites] of Object.entries(manifest.sprites)) {
      entry.frameCounts[sheetId] = Array.isArray(sprites) ? sprites.length : 0;
    }
  }

  const soundFiles = await listFiles(join(dir, 'sounds'), ['.wav', '.mp3', '.ogg', '.m4a']);
  for (const file of soundFiles) {
    const name = file.replace(/\.[^.]+$/, '');
    entry.sounds[name] = `sounds/${file}`;
  }

  return entry;
}

async function indexMultiActorFighter(fighterId, dir) {
  const actorDirs = await listDir(dir);
  const knownActors = actorDirs.filter(
    (name) => !['source', 'sheets', 'sprites', 'projectiles', 'sounds'].includes(name),
  );

  const hasManifestAtRoot = await exists(join(dir, 'manifest.json'));
  if (hasManifestAtRoot || knownActors.length === 0) {
    return indexFighter(fighterId, dir);
  }

  const entry = {
    displayName: fighterId,
    basePath: `/fighters/${fighterId}`,
    artSource: null,
    multiActor: true,
    actors: {},
    sounds: {},
  };

  const description = await exists(join(dir, 'description.txt'));
  if (description) {
    const text = await readFile(join(dir, 'description.txt'), 'utf8');
    entry.displayName = text.split('\n')[0]?.trim() || fighterId;
  }

  for (const actorId of knownActors) {
    const actorDir = join(dir, actorId);
    const actorManifest = await readJson(join(actorDir, 'manifest.json'));
    const actorFrameData = await readJson(join(actorDir, 'frameData.json'));

    const actorEntry = {
      sheets: actorManifest?.sheets ?? {},
      frameCounts: {},
      frameData: actorFrameData?.frames ?? null,
      sprites: actorManifest?.sprites ?? {},
      projectiles: actorManifest?.projectiles ?? {},
    };

    if (actorFrameData?.frames) {
      for (const [sheetId, frames] of Object.entries(actorFrameData.frames)) {
        actorEntry.frameCounts[sheetId] = Array.isArray(frames) ? frames.length : 0;
      }
    } else if (actorManifest?.sprites) {
      for (const [sheetId, sprites] of Object.entries(actorManifest.sprites)) {
        actorEntry.frameCounts[sheetId] = Array.isArray(sprites) ? sprites.length : 0;
      }
    }

    entry.actors[actorId] = actorEntry;
    if (!entry.artSource && actorManifest?.artSource) {
      entry.artSource = actorManifest.artSource;
    }
  }

  return entry;
}

async function indexArenas() {
  const arenas = {};
  const arenaDirs = await listDir(ARENAS_DIR);
  for (const arenaId of arenaDirs) {
    const dir = join(ARENAS_DIR, arenaId);
    const files = await listFiles(dir, ['.png', '.jpg', '.webp', '.svg']);
    const candidates = files.filter((f) => f.startsWith('candidate_'));
    const background = files.find((f) => f === 'background.png' || f === 'background.jpg');
    arenas[arenaId] = {
      basePath: `/arenas/${arenaId}`,
      background: background ?? null,
      candidates: candidates.map((f) => `${f}`),
    };
  }
  return arenas;
}

async function indexSounds() {
  const sounds = { sfx: {}, bgm: {} };

  const sfxFiles = await listFiles(join(AUDIO_DIR, 'sfx'), ['.wav', '.mp3', '.ogg', '.m4a']);
  for (const file of sfxFiles) {
    const name = file.replace(/\.[^.]+$/, '');
    sounds.sfx[name] = `/audio/sfx/${file}`;
  }

  const bgmFiles = await listFiles(join(AUDIO_DIR, 'bgm'), ['.wav', '.mp3', '.ogg', '.m4a']);
  for (const file of bgmFiles) {
    const name = file.replace(/\.[^.]+$/, '');
    sounds.bgm[name] = `/audio/bgm/${file}`;
  }

  return sounds;
}

async function build() {
  const fighterIds = await listDir(FIGHTERS_DIR);
  const fighters = {};

  for (const fighterId of fighterIds.sort()) {
    const dir = join(FIGHTERS_DIR, fighterId);
    fighters[fighterId] = await indexMultiActorFighter(fighterId, dir);
  }

  const arenas = await indexArenas();
  const sounds = await indexSounds();

  const index = {
    generatedAt: new Date().toISOString(),
    fighterCount: Object.keys(fighters).length,
    arenaCount: Object.keys(arenas).length,
    fighters,
    arenas,
    sounds,
    ui: {},
  };

  await writeFile(OUTPUT, JSON.stringify(index, null, 2) + '\n');

  console.log(`assets-index.json written with ${index.fighterCount} fighters, ${index.arenaCount} arenas`);
  for (const [id, f] of Object.entries(fighters)) {
    const frameStatus = f.multiActor
      ? `multi-actor (${Object.keys(f.actors).join(', ')})`
      : f.frameData ? `${Object.values(f.frameCounts).reduce((a, b) => a + b, 0)} frames` : 'no frameData';
    const soundCount = Object.keys(f.sounds ?? {}).length;
    console.log(`  ${id}: ${frameStatus}${soundCount ? `, ${soundCount} sounds` : ''}`);
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
