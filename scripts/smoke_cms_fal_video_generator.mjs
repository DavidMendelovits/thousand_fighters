import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FalVideoGeneratorAdapter, videoPayload, trustedQueueUrl, safeProviderDiagnostics } from '../cms/pipeline/adapters/falVideoGeneratorAdapter.js';
import { parseVideoArgs, runVideoJob } from './generate_animation_video.mjs';

const image = 'data:image/png;base64,aGVsbG8=';
const task = {
  requestId: 'test-123', model: 'fal-ai/kling-video/v3/standard/image-to-video',
  statusUrl: 'https://queue.fal.run/fal-ai/kling-video/requests/test-123/status',
  responseUrl: 'https://queue.fal.run/fal-ai/kling-video/requests/test-123',
};
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom0000')]);
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const safe = safeProviderDiagnostics({ detail: [{ type: 'image_too_small', loc: ['body'], msg: 'Minimum dimensions are 300x300 pixels. test-secret https://example.com/signed?token=x data:image/png;base64,aGVsbG8=', input: 'never include me' }] }, 'test-secret');
assert.equal(safe[0].type, 'image_too_small');
assert.ok(!JSON.stringify(safe).includes('test-secret'));
assert.ok(!JSON.stringify(safe).includes('signed?'));
assert.ok(!JSON.stringify(safe).includes('never include'));
assert.deepEqual(videoPayload({ mode: 'image-to-video', image, endImage: image, prompt: 'Transform', duration: 5 }), {
  prompt: 'Transform', start_image_url: image, end_image_url: image, duration: '5', generate_audio: false,
});
assert.deepEqual(videoPayload({ mode: 'motion-control', image, motion: 'https://example.com/driver.mp4', prompt: 'Jump' }), {
  prompt: 'Jump', image_url: image, video_url: 'https://example.com/driver.mp4', character_orientation: 'video', keep_original_sound: false,
});
assert.throws(() => videoPayload({ mode: 'image-to-video', image, prompt: 'X', duration: 5.5 }), /integer/);
assert.throws(() => videoPayload({ mode: 'motion-control', image, motion: 'https://example.com/a.mp4', prompt: 'X', duration: 5 }), /omit duration/);
assert.throws(() => videoPayload({ mode: 'image-to-video', image, motion: 'https://example.com/a.mp4', prompt: 'X' }), /only supported/);
for (const url of [
  'https://evil.example/fal-ai/kling-video/requests/test-123/status',
  'https://queue.fal.run.evil.example/fal-ai/kling-video/requests/test-123/status',
  'https://user:password@queue.fal.run/fal-ai/kling-video/requests/test-123/status',
  `${task.statusUrl}?secret=hello`,
  task.statusUrl.replace('test-123', 'wrong-id'),
]) assert.throws(() => trustedQueueUrl(url, task.requestId, true), /untrusted/);
assert.throws(() => parseVideoArgs(['--resume', 'out', '--prompt', 'new']), /only/);
assert.throws(() => parseVideoArgs(['--provider', 'fal', '--mode', 'motion-control', '--image', 'a.png', '--prompt', 'X', '--output', 'out']), /motion is required/);
assert.throws(() => parseVideoArgs(['--unknown', '1']), /Unknown/);
assert.throws(() => parseVideoArgs(['--resume', 'out', '--timeout-ms', 'NaN']), /positive integer/);

let requests = [];
let statuses = ['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED'];
const adapter = new FalVideoGeneratorAdapter({
  apiKey: 'test-secret', pollIntervalMs: 1, sleep: async () => {},
  fetch: async (url, options) => {
    requests.push({ url, options });
    assert.equal(options.redirect, 'error');
    if (options.method === 'POST') return json({ request_id: task.requestId, status_url: task.statusUrl, response_url: task.responseUrl });
    if (url === task.statusUrl) return json({ status: statuses.shift() });
    if (url === task.responseUrl) return json({ video: { url: 'https://v3b.fal.media/result.mp4' } });
    assert.equal(options.headers, undefined, 'Media download must have no authentication');
    return new Response(mp4);
  },
});
const submitted = await adapter.submit({ mode: 'image-to-video', image, prompt: 'Jump' });
assert.deepEqual(submitted, task);
const seen = [];
await adapter.poll(submitted, { onStatus: async (status) => seen.push(status) });
assert.deepEqual(seen, ['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED']);
assert.deepEqual(await adapter.download(await adapter.result(submitted)), mp4);
assert.equal(requests.filter(({ options }) => options.method === 'POST').length, 1);
assert.equal(requests[0].options.headers.authorization, 'Key test-secret');

let time = 0;
const timeoutAdapter = new FalVideoGeneratorAdapter({ apiKey: 'test-secret', timeoutMs: 3, pollIntervalMs: 1,
  now: () => time, sleep: async (ms) => { time += ms; }, fetch: async () => json({ status: 'IN_QUEUE' }) });
await assert.rejects(timeoutAdapter.poll(task), /timed out/);
let maliciousFetches = 0;
const guarded = new FalVideoGeneratorAdapter({ apiKey: 'test-secret', fetch: async () => { maliciousFetches += 1; } });
await assert.rejects(guarded.poll({ ...task, statusUrl: 'https://evil.example/status' }), /untrusted/);
await assert.rejects(guarded.result({ ...task, responseUrl: 'https://evil.example/result' }), /untrusted/);
assert.equal(maliciousFetches, 0);
await assert.rejects(new FalVideoGeneratorAdapter({ fetch: async () => new Response('not mp4') }).download({ url: 'https://v3b.fal.media/bad.mp4' }), /not an MP4/);

const directory = await mkdtemp(path.join(os.tmpdir(), 'fal-video-smoke-'));
try {
  const imagePath = path.join(directory, 'reference.png');
  await promisify(execFile)('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=magenta:s=320x320', '-frames:v', '1', imagePath]);
  const output = path.join(directory, 'job');
  const options = parseVideoArgs(['--provider', 'fal', '--mode', 'image-to-video', '--image', imagePath, '--prompt', 'One jump', '--output', output]);
  const smallImagePath = path.join(directory, 'small.png');
  await promisify(execFile)('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=magenta:s=128x128', '-frames:v', '1', smallImagePath]);
  await assert.rejects(runVideoJob({ ...options, image: smallImagePath, output: path.join(directory, 'small') }, {
    adapter: { submit: async () => { throw new Error('Should not submit small image'); } }, log: () => {},
  }), /requires at least 300x300/);
  let submits = 0;
  let polls = 0;
  const failing = {
    submit: async () => { submits += 1; return task; },
    poll: async () => {
      polls += 1;
      const persisted = JSON.parse(await readFile(path.join(output, 'job.json')));
      assert.equal(persisted.task.requestId, task.requestId, 'ID must be on disk before polling');
      throw new Error('simulated interruption');
    },
  };
  await assert.rejects(runVideoJob(options, { adapter: failing, log: () => {} }), /interruption/);
  const successful = {
    submit: async () => { throw new Error('Resume must never submit'); },
    poll: async (_task, { onStatus }) => { polls += 1; await onStatus('COMPLETED'); },
    result: async () => ({ url: 'https://example.com/video.mp4' }),
    download: async () => mp4,
  };
  const completed = await runVideoJob({ resume: output }, { adapter: successful, log: () => {} });
  assert.equal(completed.transportStatus, 'downloaded');
  assert.equal(completed.qualityStatus, 'unreviewed');
  assert.equal(submits, 1);
  assert.equal(polls, 2);
  const disk = await readFile(path.join(output, 'job.json'), 'utf8');
  assert.ok(!disk.includes('test-secret'));
  assert.ok(!disk.includes('data:image'));
  const reused = await runVideoJob({ resume: output }, { adapter: {}, log: () => {} });
  assert.equal(reused.output.sha256, completed.output.sha256);
  await assert.rejects(runVideoJob(options, { adapter: failing, log: () => {} }), /already contains source/);
  assert.equal(submits, 1, 'Existing output must prevent submission');
  await writeFile(path.join(output, 'source.mp4'), Buffer.concat([mp4, Buffer.from('changed')]));
  await assert.rejects(runVideoJob({ resume: output }, { adapter: {}, log: () => {} }), /hash differs/);

  const uncertainOutput = path.join(directory, 'uncertain');
  await assert.rejects(runVideoJob({ ...options, output: uncertainOutput }, {
    adapter: { submit: async () => { throw new Error('connection lost after POST'); } }, log: () => {},
  }), /connection lost/);
  await assert.rejects(runVideoJob({ resume: uncertainOutput }, { adapter: successful, log: () => {} }), /no persisted request ID/);
} finally { await rm(directory, { recursive: true, force: true }); }
console.log('fal video generator smoke passed: payloads, URL guards, timeout, checkpoint, resume, reuse, uncertain submit.');
