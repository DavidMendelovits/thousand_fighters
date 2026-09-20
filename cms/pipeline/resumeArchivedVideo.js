import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getArchivedEvent } from '../repositories/characterHistory.js';
import { runVideoJob } from '../../scripts/generate_animation_video.mjs';

/** Rehydrate a checkpoint from immutable storage. Only resume is allowed:
 * a missing provider request ID is NEVER treated as permission to submit. */
export async function resumeArchivedVideo({ storage, characterId, eventId, adapter }) {
  const event = await getArchivedEvent(storage, characterId, eventId);
  if (event.type !== 'video-checkpoint') throw new Error('Select a video job checkpoint.');
  const job = JSON.parse(await storage.lineage.readArtifact(event.artifact));
  if (!job.task?.requestId && job.transportStatus !== 'downloaded') throw new Error('Submission has no confirmed request ID. Check provider history; no new job was submitted.');
  await mkdir(path.resolve('artifacts/workbench-video-jobs'), { recursive: true });
  const directory = await mkdtemp(path.resolve('artifacts/workbench-video-jobs/recovered-'));
  for (const { role, artifact } of job.archivedReferences ?? []) {
    if (!['image', 'endImage', 'motion'].includes(role)) throw new Error('Invalid archived reference role.');
    const filename = path.join(directory, `${role}.${artifact.contentType === 'video/mp4' ? 'mp4' : 'png'}`);
    await writeFile(filename, await storage.lineage.readArtifact(artifact), { flag: 'wx' });
    if (job.request.references[role]) job.request.references[role].path = filename;
  }
  if (job.archivedOutput) await writeFile(path.join(directory, 'source.mp4'), await storage.lineage.readArtifact(job.archivedOutput), { flag: 'wx' });
  await writeFile(path.join(directory, 'job.json'), `${JSON.stringify(job, null, 2)}\n`, { flag: 'wx' });
  return storage.lineage.run({ characterId, stage: 'resume-video-job', parentEventId: eventId, inputs: { provider: job.provider, requestId: job.task?.requestId } }, async () => {
    const result = await runVideoJob({ resume: directory }, { storage, characterId, adapter, moveId: event.moveId, onGenerationAttempt: async attempt => {
      const key = `benchmarks/generation-attempts/${attempt.startedAt.slice(0, 10)}/${attempt.attemptId}-${attempt.completedAt.replaceAll(':', '-')}.json`;
      await storage.putJson(key, { ...attempt, characterId, moveId: event.moveId, benchmarkKey: key });
    } });
    return { directory, transportStatus: result.transportStatus, output: result.archivedOutput, requestId: result.task?.requestId };
  });
}
