import { readFile, writeFile } from 'node:fs/promises';
import { createCmsStorage } from '../cms/storage/createCmsStorage.js';
import { CharacterContentRepository } from '../cms/repositories/CharacterContentRepository.js';

const characterId = 'palimpsest';
const configPath = 'public/fighters/palimpsest/config.json';
const handRows = new Set(['hands_idle', 'needle_thrust', 'hands_pinch', 'hands_recall']);

function actorSprite(sprite, rows) {
  return {
    ...sprite,
    frames: Object.fromEntries(rows.map(row => [row, sprite.frames[row]])),
    frameCounts: Object.fromEntries(rows.map(row => [row, sprite.frameCounts[row]])),
    rowPlayback: Object.fromEntries(rows.map(row => [row, sprite.rowPlayback[row]])),
  };
}

function repairActors(document) {
  const sprite = document.sprite;
  if (!sprite?.frames || !Array.isArray(document.actors)) throw new Error('Palimpsest sprite contract is incomplete.');
  const rows = Object.keys(sprite.frames).filter(row => row !== 'base');
  const leadRows = rows.filter(row => !handRows.has(row));
  const handsRows = rows.filter(row => handRows.has(row));
  return document.actors.map(actor => actor.id === 'lead'
    ? { ...actor, sprite: actorSprite(sprite, leadRows) }
    : actor.id === 'hands'
      ? { ...actor, sprite: actorSprite(sprite, handsRows) }
      : actor);
}

const config = JSON.parse(await readFile(configPath, 'utf8'));
config.actors = repairActors(config);
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

const repository = new CharacterContentRepository(createCmsStorage());
const draft = await repository.getDraft(characterId);
draft.actors = repairActors(draft);
await repository.saveDraft(characterId, draft, { provider: 'runtime-memory-repair' });
const version = await repository.createVersion(characterId, draft, {
  label: 'Split Palimpsest actor rows for mobile runtime memory',
});

console.log(JSON.stringify({
  characterId,
  leadFrames: Object.values(config.actors.find(actor => actor.id === 'lead').sprite.frames).reduce((sum, frames) => sum + frames.length, 0),
  handsFrames: Object.values(config.actors.find(actor => actor.id === 'hands').sprite.frames).reduce((sum, frames) => sum + frames.length, 0),
  versionId: version.versionId,
}));
