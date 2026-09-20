import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { segment } from '../storage/LineageStore.js';
import { installMotionRow } from './motionRowArtifacts.js';
import { getArchivedEvent, prepareVersionWorkingCopy } from '../repositories/characterHistory.js';
import { motionActorReference, motionCompilerSettings, motionCompilerArgs } from './motionReference.js';
const exec = promisify(execFile);

/** Explicit offline branch. No provider credentials or network requests. */
export async function resolveMotionVideo({ storage, characterId, sourceSha256 }) {
  if (!/^[a-f0-9]{64}$/.test(sourceSha256 ?? '')) throw new Error('This row has no archived video source.');
  let before;
  do {
    const page = await storage.lineage.events(characterId, { before, limit: 200 });
    const event = page.events.find(e => (e.output ?? e.artifact)?.sha256 === sourceSha256 && (e.output ?? e.artifact)?.contentType === 'video/mp4');
    if (event) return event;
    before = page.nextCursor;
  } while (before);
  throw new Error('No video with this hash is archived for this character. Import its source into history first.');
}

export function validateReprocess({ frames = 20, loop = false, start, end, matteCleanup = false, refineEdges = false, contactFrame, recoveryFrame }) {
  if (!Number.isInteger(frames) || frames < 8 || frames > 48 || typeof loop !== 'boolean' || typeof matteCleanup !== 'boolean') throw new Error('Choose 8–48 frames, a loop setting, and a paint cleanup setting.');
  if (typeof refineEdges !== 'boolean') throw new Error('Choose a valid paint edge refinement setting.');
  for (const value of [start, end]) if (value != null && (!Number.isInteger(value) || value < 0 || value > 359)) throw new Error('Source frame indices must be whole numbers from 0 to 359.');
  if (end != null && end - (start ?? 0) + (loop ? 0 : 1) < frames) throw new Error('The source range must contain at least the requested number of output frames; loops omit the endpoint.');
  for (const value of [contactFrame, recoveryFrame]) if (value != null && (!Number.isInteger(value) || value < 1 || value >= frames)) throw new Error('Contact and recovery poses must be inside the output row after the starting pose.');
  if (contactFrame != null && contactFrame >= frames - 1) throw new Error('Contact must leave at least one recovery pose.');
  if (recoveryFrame != null && (contactFrame == null || recoveryFrame <= contactFrame)) throw new Error('Recovery must follow contact.');
}

export async function reprocessArchivedVideo({ repository, storage, characterId, eventId, action, frames = 20, loop = false, start, end, matteCleanup = false, refineEdges = false, contactFrame, recoveryFrame, expectedSourceSha256, expectedUpdatedAt }) {
  segment(characterId);
  if (!/^[a-z][a-z0-9_-]*$/.test(action ?? '') || !Number.isInteger(frames) || frames < 8 || frames > 48 || typeof loop !== 'boolean') throw new Error('Choose a valid action, 8–48 frames, and a loop setting.');
  validateReprocess({ frames, loop, start, end, matteCleanup, refineEdges, contactFrame, recoveryFrame });
  const draft = await repository.getDraft(characterId);
  if (expectedUpdatedAt && expectedUpdatedAt !== draft.updatedAt) throw Object.assign(new Error('The draft changed. Refresh before reprocessing.'), { statusCode: 409 });
  if (!draft.sprite?.frames?.[action] && !draft.moves?.some(m => m.animation === action)) throw new Error('Select an existing animation row.');
  const hasGrip = draft.moves?.some(m => m.animation === action && m.phases?.some(p => p.events?.some(e => e.event?.grab?.actorGrip)));
  if (hasGrip && (contactFrame == null || recoveryFrame == null)) throw new Error('Paired grabs need contact and recovery poses. Use Reprocess saved video on the move card.');
  const event = eventId ? await getArchivedEvent(storage, characterId, eventId) : await resolveMotionVideo({ storage, characterId, sourceSha256: draft.motionRows?.[action]?.sourceSha256 });
  eventId = event.id;
  const video = event.output ?? event.artifact;
  if (video?.contentType !== 'video/mp4') throw new Error('Selected event does not contain an archived source video.');
  if (expectedSourceSha256 && video.sha256 !== expectedSourceSha256) throw Object.assign(new Error('The row source changed. Refresh before reprocessing.'), { statusCode: 409 });
  const pack = draft.assets?.rootKey ?? `characters/${characterId}/assets/fighter-pack`;
  const { actorId, referenceFile } = motionActorReference(draft, action, await storage.getJson(`${pack}/frameData.json`));
  const referenceKey = `${pack}/${referenceFile}`;
  const referenceBytes = await storage.getBytes(referenceKey);
  const reference = await storage.lineage.artifact(referenceBytes, { contentType: 'image/png' });
  const settings = motionCompilerSettings(draft.artStyle);
  if ((matteCleanup || refineEdges) && settings.background !== 'paint-auto') throw new Error('Paint edge cleanup is only available for paint sources with a flat background.');
  return storage.lineage.run({ characterId, stage: 'reprocess-motion', moveId: action, parentEventId: eventId, inputs: { video, reference, referenceKey, actorId, action, frames, loop, start, end, matteCleanup, refineEdges, contactFrame, recoveryFrame, ...settings, compiler: await storage.lineage.artifact(await readFile('scripts/compile_character_motion.py'), { contentType: 'text/x-python' }) } }, async () => {
    await mkdir(path.resolve('artifacts/workbench-video-jobs'), { recursive: true });
    const directory = await mkdtemp(path.resolve('artifacts/workbench-video-jobs/reprocess-'));
    await writeFile(path.join(directory, 'source.mp4'), await storage.lineage.readArtifact(video));
    await writeFile(path.join(directory, 'reference.png'), referenceBytes);
    const compiled = path.join(directory, 'compiled');
    const started = Date.now();
    await exec('python3', ['scripts/compile_character_motion.py', path.join(directory, 'source.mp4'), '--reference', path.join(directory, 'reference.png'), '--output', compiled, '--action', action, '--frames', String(frames), ...motionCompilerArgs(settings), ...(loop ? ['--loop'] : []), ...(start != null ? ['--start', String(start)] : []), ...(end != null ? ['--end', String(end)] : []), ...(matteCleanup ? ['--matte-cleanup'] : []), ...(refineEdges ? ['--refine-edges'] : [])], { timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
    const compileMs = Date.now() - started;
    const safety = await repository.createVersion(characterId, draft, { label: `Before reprocessing ${action}` });
    const working = await prepareVersionWorkingCopy(repository, characterId, safety.versionId);
    working.history.safetyVersionId = safety.versionId;
    for (const move of working.moves ?? []) if (move.animation === action) {
      for (const phase of move.phases ?? []) for (const entry of phase.events ?? []) {
        const grip = entry.event?.grab?.actorGrip;
        if (grip && contactFrame != null && recoveryFrame != null) {
          grip.holdStartFrame = contactFrame; grip.holdEndFrame = recoveryFrame - 1;
        }
      }
    }
    const branchRepository = Object.create(repository);
    branchRepository.getDraft = async () => working;
    branchRepository.saveDraft = (...args) => repository.saveDraft(...args);
    // All asset writes target the private working root. saveDraft is the switch.
    const result = await installMotionRow({ characterId, directory: compiled, storage, repository: branchRepository, contactFrame, recoveryFrame });
    const after = await repository.createVersion(characterId, await repository.getDraft(characterId), { label: `Reprocessed ${action} · needs review` });
    await storage.lineage.event(characterId, { type: 'motion-reprocessed', moveId: action, parentEventId: eventId, sourceSha256: video.sha256, safetyVersionId: safety.versionId, versionId: after.versionId, workingRoot: working.history.workingRoot, compileMs, providerRequests: 0 });
    return { ...result, directory, compileMs, providerRequests: 0, safetyVersionId: safety.versionId, versionId: after.versionId };
  });
}
