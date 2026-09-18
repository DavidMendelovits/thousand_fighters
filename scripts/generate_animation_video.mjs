import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, open, unlink, access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { FalVideoGeneratorAdapter, FAL_VIDEO_MODELS, videoPayload, publicHttpsUrl, assertMp4 } from '../cms/pipeline/adapters/falVideoGeneratorAdapter.js';
import { emitAttempt } from '../cms/pipeline/generationAttemptTelemetry.js';
import {PrunaVideoGeneratorAdapter,PRUNA_VIDEO_MODEL,prunaVideoPayload} from '../cms/pipeline/adapters/prunaVideoGeneratorAdapter.js';
import { createCmsStorage } from '../cms/storage/createCmsStorage.js';

const execFileAsync = promisify(execFile);

const HELP = `Generate a resumable source video (quality remains unreviewed).
  node scripts/generate_animation_video.mjs --provider pruna --mode image-to-video --image start.png --prompt "..." --duration 5 --resolution 480p --recipe quality --output DIR
  node scripts/generate_animation_video.mjs --provider fal --mode image-to-video --image start.png --end-image end.png --prompt "..." --duration 5 --output DIR
  node scripts/generate_animation_video.mjs --provider fal --mode motion-control --image start.png --motion driver.mp4 --prompt "..." --output DIR
  node scripts/generate_animation_video.mjs --resume DIR
Options: --timeout-ms 900000 --poll-ms 5000; motion-control: --orientation video|image.
FAL_KEY or PRUNA_API_KEY must be supplied through the environment. Pruna uses 5–15 seconds and includes generated audio. No generation is automatically re-submitted.`;

export function parseVideoArgs(args) {
  const allowed = new Set(['provider', 'mode', 'image', 'end-image', 'motion', 'prompt', 'output', 'resume', 'duration', 'orientation', 'timeout-ms', 'poll-ms','resolution','recipe']);
  const result = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--help') return { help: true };
    const match = args[i].match(/^--([^=]+)(?:=(.*))?$/s);
    if (!match || !allowed.has(match[1])) throw new Error(`Unknown argument: ${args[i]}`);
    if (Object.hasOwn(result, match[1])) throw new Error(`Duplicate argument: --${match[1]}`);
    const value = match[2] ?? args[++i];
    if (value === undefined || value.startsWith('--') || !value.trim()) throw new Error(`Missing value for --${match[1]}`);
    result[match[1]] = value;
  }
  if (result.resume) {
    if (Object.keys(result).some((key) => !['resume', 'timeout-ms', 'poll-ms'].includes(key))) throw new Error('--resume accepts only timeout-ms and poll-ms overrides.');
  } else {
    if (!['fal','pruna'].includes(result.provider)) throw new Error('--provider fal or pruna is required.');
    for (const key of ['mode', 'image', 'prompt', 'output']) if (!result[key]) throw new Error(`--${key} is required.`);
    if (!FAL_VIDEO_MODELS[result.mode]) throw new Error('--mode must be image-to-video or motion-control.');
    if (result.mode === 'motion-control' && !result.motion) throw new Error('--motion is required for motion-control.');
    if (result.mode === 'image-to-video' && result.orientation) throw new Error('--orientation applies only to motion-control.');
  }
  for (const key of ['timeout-ms', 'poll-ms']) {
    if (result[key] && (!Number.isSafeInteger(Number(result[key])) || Number(result[key]) <= 0)) throw new Error(`--${key} must be a positive integer.`);
  }
  return result;
}

export async function runVideoJob(options, { adapter, log = console.log, onGenerationAttempt, storage = createCmsStorage(), characterId = null, moveId = null } = {}) {
  const invocationStartedAt = Date.now();
  if (options.help) { log(HELP); return; }
  const provider=options.resume?JSON.parse(await readFile(path.join(path.resolve(options.resume),'job.json'),'utf8')).provider:options.provider??'fal';
  if(!['fal','pruna'].includes(provider))throw new Error('Unsupported video provider.');
  adapter ??= new (provider==='pruna'?PrunaVideoGeneratorAdapter:FalVideoGeneratorAdapter)({ timeoutMs: options['timeout-ms'], pollIntervalMs: options['poll-ms'] });
  const directory = path.resolve(options.resume ?? options.output);
  const jobPath = path.join(directory, 'job.json');
  const videoPath = path.join(directory, 'source.mp4');
  await mkdir(directory, { recursive: true });
  // Exclusive worker lock prevents overlapping resumes from racing file writes.
  const lockPath = path.join(directory, '.video-job.lock');
  let lock;
  try { lock = await open(lockPath, 'wx'); } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Job is locked. If its worker died, verify no worker is running and remove ${lockPath} before resuming.`);
    throw error;
  }
  await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  let job;
  const checkpoint = async () => {
    job.updatedAt = new Date().toISOString();
    await atomicWrite(jobPath, `${JSON.stringify(job, null, 2)}\n`);
    await archiveCheckpoint();
  };
  const archiveCheckpoint = async () => {
    const artifact = await storage.lineage.artifact(Buffer.from(`${JSON.stringify(job, null, 2)}\n`), { contentType: 'application/json' });
    await storage.lineage.event(characterId, { type: 'video-checkpoint', stage: 'video-generation', moveId, attemptId: job.generationAttempt?.attemptId, provider, model: job.model, transportStatus: job.transportStatus, artifact, directory, references: job.archivedReferences ?? [], output: job.archivedOutput ?? null });
  };
  try {
    if (options.resume) {
      job = JSON.parse(await readFile(jobPath, 'utf8'));
      if (job.schemaVersion !== 1 || job.provider !== provider || job.model !== (provider==='pruna'?PRUNA_VIDEO_MODEL:FAL_VIDEO_MODELS[job.mode])) throw new Error('Unsupported or invalid job record.');
      if (job.transportStatus === 'downloaded') {
        const bytes = await readFile(videoPath);
        assertMp4(bytes);
        if (sha256(bytes) !== job.output.sha256) throw new Error('Stored source.mp4 hash differs from the job record.');
        log(`Reusing completed video: ${videoPath}`);
        job.archivedOutput = await storage.lineage.artifact(bytes, { contentType: 'video/mp4' });
        await archiveCheckpoint();
        return job;
      }
      if (!job.task?.requestId) throw new Error('Job has no persisted request ID. Submission may have been accepted; investigate fal history. Resume will not submit again.');
    } else {
      try {
        await access(videoPath);
        throw new Error('Output already contains source.mp4. Use a fresh output directory or resume its existing job.');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const references = {};
      const inputPreparationStartedAt = Date.now();
      const image = await loadMedia(options.image, 'image', references, 'image');
      const endImage = options['end-image'] ? await loadMedia(options['end-image'], 'image', references, 'endImage') : undefined;
      const motion = options.motion ? await loadMedia(options.motion, 'video', references, 'motion') : undefined;
      const request = { mode: options.mode, image, endImage, motion, prompt: options.prompt,
        duration: options.duration, orientation: options.orientation,resolution:options.resolution,recipe:options.recipe };
      // Validate payload and files before reserving or making a billable request.
      const payload = provider==='pruna'?prunaVideoPayload(request):videoPayload(request);
      job = {
        schemaVersion: 1, provider, model: provider==='pruna'?PRUNA_VIDEO_MODEL:FAL_VIDEO_MODELS[options.mode], mode: options.mode,
        createdAt: new Date().toISOString(), transportStatus: 'submitting', qualityStatus: 'unreviewed',
        request: { prompt: options.prompt, duration: payload.duration ?? null, resolution:payload.resolution??null,recipe:payload.mode??null,orientation: payload.character_orientation ?? null, audio: provider==='pruna', references, payloadSha256: sha256(JSON.stringify(payload)) },
        submissionAttempts: 1,
        timings: { inputPreparationMs: Date.now() - inputPreparationStartedAt },
        generationAttempt: { attemptId: randomUUID(), startedAt: new Date().toISOString(), status: 'running' },
      };
      job.archivedReferences = [];
      for (const [role, reference] of Object.entries(references)) {
        if (reference.kind === 'file') job.archivedReferences.push({ role, artifact: await storage.lineage.artifact(await readFile(reference.path), { contentType: reference.contentType }) });
      }
      // An existing job is never overwritten, even if the prior submit was uncertain.
      await durableWrite(jobPath, `${JSON.stringify(job, null, 2)}\n`, 'wx');
      await archiveCheckpoint(); // storage must work BEFORE the paid submission
      const submissionStartedAt = Date.now();
      job.task = await adapter.submit(request);
      job.timings.submissionMs = Date.now() - submissionStartedAt;
      Object.assign(job.timings,job.task.timings??{});
      job.transportStatus = 'submitted';
      await checkpoint();
      log(`Submitted ${job.model}; request ${job.task.requestId}. Job persisted at ${jobPath}`);
    }
    if (job.remoteStatus !== 'COMPLETED') {
      const pollingStartedAt = Date.now();
      await adapter.poll(job.task, { onStatus: async (status) => {
        job.remoteStatus = status;
        job.transportStatus = 'polling';
        await checkpoint();
        log(`${provider}: ${status}`);
      } });
      job.timings = { ...(job.timings ?? {}), providerQueueAndGenerationMs: Date.now() - pollingStartedAt };
    }
    job.remoteStatus = 'COMPLETED';
    job.transportStatus = 'downloading';
    await checkpoint();
    const resultLookupStartedAt = Date.now();
    const video = await adapter.result(job.task);
    job.timings = { ...(job.timings ?? {}), resultLookupMs: Date.now() - resultLookupStartedAt };
    const downloadStartedAt = Date.now();
    const bytes = await adapter.download(video);
    job.timings.downloadMs = Date.now() - downloadStartedAt;
    await atomicWrite(videoPath, bytes);
    job.archivedOutput = await storage.lineage.artifact(bytes, { contentType: 'video/mp4' });
    job.output = { path: 'source.mp4', contentType: 'video/mp4', bytes: bytes.length, sha256: sha256(bytes) };
    job.transportStatus = 'downloaded';
    job.completedAt = new Date().toISOString();
    job.timings.transportInvocationMs = Date.now() - invocationStartedAt;
    const activeDurationMs = (job.generationAttempt?.activeDurationMs ?? 0) + job.timings.transportInvocationMs;
    job.generationAttempt = {
      ...(job.generationAttempt ?? { attemptId: randomUUID(), startedAt: job.createdAt }),
      completedAt: job.completedAt,
      durationMs: activeDurationMs,
      activeDurationMs,
      status: 'succeeded',
    };
    delete job.lastError;
    await checkpoint();
    await emitAttempt({ onGenerationAttempt }, videoAttemptEvent(job));
    log(`Source video saved: ${videoPath}. Quality is unreviewed; run the offline compiler and review.`);
    return job;
  } catch (error) {
    // Only update a record that this invocation created or loaded. Avoid overwriting
    // another job when exclusive initial creation failed.
    if (job && error.code !== 'EEXIST') {
      if(!job.task?.requestId&&[400,401,403,422].includes(error.statusCode))job.transportStatus='submission-rejected';
      if (job.remoteStatus === 'COMPLETED' && error.statusCode === 422) job.transportStatus = 'provider-rejected';
      job.lastError = { at: new Date().toISOString(), kind: error.name ?? 'Error', statusCode: error.statusCode ?? null,
        message: job.task?.requestId ? 'Run failed after submission. Resume this directory; do not create a duplicate generation.' : 'Submission not confirmed. Inspect provider history before any new submission.' };
      if (job.transportStatus === 'provider-rejected') job.lastError.message = 'Provider rejected this task. Resume only re-reads this result; corrected inputs require a deliberate new submission in a new output directory.';
      if(job.transportStatus==='submission-rejected')job.lastError.message='Provider rejected the submission before issuing a task id. After correcting the cause, explicitly regenerate to create a new job.';
      if (error.diagnostics?.length) job.lastError.diagnostics = error.diagnostics;
      const completedAt = new Date().toISOString();
      const activeDurationMs = (job.generationAttempt?.activeDurationMs ?? 0) + (Date.now() - invocationStartedAt);
      job.generationAttempt = {
        ...(job.generationAttempt ?? { attemptId: randomUUID(), startedAt: job.createdAt ?? completedAt }),
        completedAt,
        durationMs: activeDurationMs,
        activeDurationMs,
        status: 'failed',
      };
      await checkpoint();
      await emitAttempt({ onGenerationAttempt }, videoAttemptEvent(job, error));
    }
    throw error;
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

function videoAttemptEvent(job, error) {
  return {
    schemaVersion: 1,
    attemptId: job.generationAttempt.attemptId,
    startedAt: job.generationAttempt.startedAt,
    completedAt: job.generationAttempt.completedAt,
    durationMs: job.generationAttempt.durationMs,
    status: job.generationAttempt.status,
    kind: 'video',
    provider: job.provider,
    model: job.model,
    operation: job.mode,
    characterId: null,
    arenaId: null,
    moveId: null,
    projectileId: null,
    frameNumber: null,
    attemptNumber: job.submissionAttempts ?? 1,
    referenceCount: Object.keys(job.request?.references ?? {}).length,
    providerTaskId: job.task?.requestId ?? null,
    stageTimings: job.timings ?? null,
    usage: null,
    estimatedCostUsd: null,
    ...(error ? { error: { name: error.name ?? 'Error', statusCode: error.statusCode ?? null, message: job.lastError?.message ?? 'Video generation failed.' } } : {}),
  };
}

async function loadMedia(value, type, references, label) {
  if (/^https?:\/\//i.test(value)) {
    const url = publicHttpsUrl(value);
    const parsed = new URL(url);
    references[label] = { kind: 'url', urlOrigin: parsed.origin, urlSha256: sha256(url) };
    return url;
  }
  const filename = path.resolve(value);
  const extensions = type === 'image' ? { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }
    : { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' };
  const mime = extensions[path.extname(filename).toLowerCase()];
  if (!mime) throw new Error(`Unsupported ${type} extension.`);
  const bytes = await readFile(filename);
  if (!bytes.length || bytes.length > 50 * 1024 * 1024) throw new Error('Local media must be nonempty and at most 50 MiB; use a hosted HTTPS URL for larger drivers.');
  let dimensions;
  if (type === 'image') {
    const { stdout } = await execFileAsync(process.env.FFPROBE_BIN ?? 'ffprobe', [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', filename,
    ], { timeout: 10000, maxBuffer: 1024 * 1024 });
    const stream = JSON.parse(stdout).streams?.[0];
    if (!Number.isInteger(stream?.width) || !Number.isInteger(stream?.height)) throw new Error('Cannot determine local reference image dimensions.');
    dimensions = { width: stream.width, height: stream.height };
    if (stream.width < 300 || stream.height < 300) throw new Error(`Reference image is ${stream.width}x${stream.height}; Kling requires at least 300x300. Prepare a padded reference before submission.`);
  }
  references[label] = { kind: 'file', path: filename, contentType: mime, bytes: bytes.length, sha256: sha256(bytes), ...(dimensions ?? {}) };
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

async function atomicWrite(filename, contents) {
  const temporary = `${filename}.${process.pid}.tmp`;
  await durableWrite(temporary, contents);
  await rename(temporary, filename);
}
async function durableWrite(filename, contents, flags = 'w') {
  const file = await open(filename, flags);
  try { await file.writeFile(contents); await file.sync(); } finally { await file.close(); }
}
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const {createCmsStorage}=await import('../cms/storage/createCmsStorage.js');
    const storage=createCmsStorage();
    await runVideoJob(parseVideoArgs(process.argv.slice(2)),{onGenerationAttempt:async event=>{
      const key=`benchmarks/generation-attempts/${event.startedAt.slice(0,10)}/${event.attemptId}-${event.completedAt.replaceAll(':','-')}.json`;
      await storage.putJson(key,{...event,benchmarkKey:key});
    }});
  }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
