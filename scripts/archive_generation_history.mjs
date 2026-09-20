import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createCmsStorage } from '../cms/storage/createCmsStorage.js';
import { CharacterContentRepository } from '../cms/repositories/CharacterContentRepository.js';
import { digest } from '../cms/storage/LineageStore.js';

// Non-destructive migration: originals stay in place. Existing lineage is never
// invented; imported files are explicitly marked as legacy observations.
const storage = createCmsStorage();
const repository = new CharacterContentRepository(storage);
const apply = process.argv.includes('--apply');
const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.json': 'application/json', '.jsonl': 'application/x-ndjson' };
const files = [];
async function walk(directory) {
  let entries; try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory() && /^(reprocess|recovered)-/.test(entry.name)) continue; // new pipeline already archives these
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(filename);
    else if (entry.isFile() && mime[path.extname(filename)]) files.push(filename);
  }
}
for (const directory of ['generated', 'artifacts/workbench-video-jobs']) await walk(directory);
console.log(JSON.stringify({ mode: apply ? 'archive' : 'dry-run', files: files.length, provider: storage.provider }));
if (apply) {
  const characters = await repository.listCharacters();
  let imported = 0;
  for (const filename of files) {
    const bytes = await readFile(filename);
    const importId = digest(`${filename}:${digest(bytes)}`);
    const marker = `lineage/imports/${importId}.json`;
    if (await storage.exists(marker)) continue;
    const owner = characters.find(character => filename.split('/').some(part => part === character.id || part.startsWith(`${character.id}-`)))?.id ?? null;
    const artifact = await storage.lineage.artifact(bytes, { contentType: mime[path.extname(filename)] });
    const event = await storage.lineage.event(owner, { type: 'legacy-import', stage: 'legacy-file-import', logicalKey: filename, artifact, lineageConfidence: 'File retained; parent relationships not reconstructed' });
    await storage.putJson(marker, { filename, artifact, eventId: event.id, characterId: owner });
    imported++;
    if (imported % 100 === 0) console.log(`Archived ${imported} files`);
  }
  for (const character of characters) {
    const versions = await repository.listVersions(character.id);
    for (const version of versions.filter(version => version.restorable)) {
      const contentKey = repository.versionKey(character.id, version.versionId);
      const sealKey = contentKey.replace(/content.json$/, 'integrity.json');
      if (!(await storage.exists(sealKey))) {
        const content = await storage.getJson(contentKey);
        await storage.putJson(sealKey, { schemaVersion: 1, content: await storage.lineage.artifact(await storage.getBytes(contentKey), { contentType: 'application/json' }), manifest: await storage.lineage.artifact(await storage.getBytes(content.history.manifestKey), { contentType: 'application/json' }) });
      }
    }
    if (versions.some(version => version.label === 'Initial immutable archive baseline')) continue;
    const draft = await repository.getDraft(character.id);
    const version = await repository.createVersion(character.id, draft, { label: 'Initial immutable archive baseline' });
    console.log(`Checkpoint ${character.id}: ${version.history.assetCount} assets`);
  }
  console.log(`Archived ${imported} new files. No originals deleted or active drafts changed.`);
}
