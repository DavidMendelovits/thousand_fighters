import { readFile, writeFile } from 'node:fs/promises';
import { createDavid } from '../src/characters/david';

const root = new URL('../public/fighters/david/', import.meta.url);
const data = JSON.parse(await readFile(new URL('frameData.json', root), 'utf8'));
const config = createDavid();
config.sprite = { basePath: '/fighters/david', scale: 1, frames: data.frames,
  frameCounts: Object.fromEntries(Object.entries(data.frames).map(([key, frames]) => [key, (frames as unknown[]).length])), sheets: {},
  stateFrames: { idle: 0, landing: 0, dead: 0, grabbed: 0, knockdown: 0, getup: 0 } };
await writeFile(new URL('config.json', root), JSON.stringify(config, null, 2)+'\n');
await writeFile(new URL('moveset.json', root), JSON.stringify(config.moves, null, 2)+'\n');
await writeFile(new URL('description.txt', root), config.concept!.biography+'\n'+config.concept!.artStatus+'\n');
await writeFile(new URL('moveset.txt', root), config.moves.map(m=>`${m.displayName} (${m.inputLabel})\n${m.description}\n${m.phases.map(p=>`${p.name}: ${p.frames} ticks`).join(', ')}`).join('\n\n')+'\n');
console.log('Exported David only. Existing fighters untouched.');
