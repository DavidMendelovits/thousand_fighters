import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { segment } from '../storage/LineageStore.js';
import { installMotionRow } from './motionRowArtifacts.js';
import { getArchivedEvent } from '../repositories/characterHistory.js';
const exec = promisify(execFile);

/** Explicit offline branch. No provider credentials or network requests. */
export async function reprocessArchivedVideo({ repository, storage, characterId, eventId, action, frames = 20, loop = false }) {
  segment(characterId); segment(eventId);
  if (!/^[a-z][a-z0-9_-]*$/.test(action ?? '') || !Number.isInteger(frames) || frames < 8 || frames > 48 || typeof loop !== 'boolean') throw new Error('Choose a valid action, 8–48 frames, and a loop setting.');
  const event = await getArchivedEvent(storage, characterId, eventId);
  const video = event.output ?? event.artifact;
  if (video?.contentType !== 'video/mp4') throw new Error('Selected event does not contain an archived source video.');
  const draft = await repository.getDraft(characterId);
  const referenceKey = `${draft.assets?.rootKey ?? `characters/${characterId}/assets/fighter-pack`}/sprites/base/base_001.png`;
  const referenceBytes = await storage.getBytes(referenceKey);
  const reference = await storage.lineage.artifact(referenceBytes, { contentType: 'image/png' });
  const style = draft.artStyle === 'watercolor' ? 'watercolor' : 'pixel';
  return storage.lineage.run({ characterId, stage: 'reprocess-motion', parentEventId: eventId, inputs: { video, reference, action, frames, loop, style, compiler: await storage.lineage.artifact(await readFile('scripts/compile_character_motion.py'), { contentType: 'text/x-python' }) } }, async () => {
    await mkdir(path.resolve('artifacts/workbench-video-jobs'), { recursive: true });
    const directory = await mkdtemp(path.resolve('artifacts/workbench-video-jobs/reprocess-'));
    await writeFile(path.join(directory, 'source.mp4'), await storage.lineage.readArtifact(video));
    await writeFile(path.join(directory, 'reference.png'), referenceBytes);
    const compiled = path.join(directory, 'compiled');
    await exec('python3', ['scripts/compile_character_motion.py', path.join(directory, 'source.mp4'), '--reference', path.join(directory, 'reference.png'), '--output', compiled, '--action', action, '--frames', String(frames), '--style', style, ...(loop ? ['--loop'] : [])], { timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
    await repository.createVersion(characterId, await repository.getDraft(characterId), { label: `Before re-extracting ${action}` });
    return installMotionRow({ characterId, directory: compiled, storage, repository });
  });
}
