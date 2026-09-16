const QUEUE_ORIGIN = 'https://queue.fal.run';
export const FAL_VIDEO_MODELS = Object.freeze({
  'image-to-video': 'fal-ai/kling-video/v3/standard/image-to-video',
  'motion-control': 'fal-ai/kling-video/v3/standard/motion-control',
});

/** Source-video transport only. Completion does not mean animation quality acceptance. */
export class FalVideoGeneratorAdapter {
  constructor(options = {}) {
    this.apiKey = options.apiKey ?? process.env.FAL_KEY ?? '';
    this.fetch = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.pollIntervalMs = positiveInteger(options.pollIntervalMs ?? 5000, 'pollIntervalMs');
    this.timeoutMs = positiveInteger(options.timeoutMs ?? 900000, 'timeoutMs');
    this.requestTimeoutMs = positiveInteger(options.requestTimeoutMs ?? 60000, 'requestTimeoutMs');
  }

  async submit(request) {
    const payload = videoPayload(request);
    const model = FAL_VIDEO_MODELS[request.mode];
    const created = await this.requestJson(`${QUEUE_ORIGIN}/${model}`, {
      method: 'POST', body: JSON.stringify(payload),
    });
    if (typeof created.request_id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(created.request_id)) {
      throw new Error('fal submission returned no valid request ID; submission state is uncertain. Do not automatically resubmit.');
    }
    // Persist the ID before polling/validating returned URLs in the caller. A bad URL
    // must never turn an already-paid submission into an automatic new submission.
    return {
      requestId: created.request_id,
      model,
      statusUrl: created.status_url ?? `${QUEUE_ORIGIN}/fal-ai/kling-video/requests/${created.request_id}/status`,
      responseUrl: created.response_url ?? `${QUEUE_ORIGIN}/fal-ai/kling-video/requests/${created.request_id}`,
    };
  }

  async poll(task, { onStatus = async () => {} } = {}) {
    const statusUrl = trustedQueueUrl(task.statusUrl, task.requestId, true);
    const deadline = this.now() + this.timeoutMs;
    let status;
    let transientFailures = 0;
    while (this.now() < deadline) {
      let value;
      try {
        value = await this.requestJson(statusUrl, {}, deadline - this.now());
        transientFailures = 0;
      } catch (error) {
        if (![408, 429, 500, 502, 503, 504].includes(error.statusCode) || transientFailures >= 3) throw error;
        transientFailures += 1;
        await this.sleep(Math.min(this.pollIntervalMs * transientFailures, Math.max(0, deadline - this.now())));
        continue;
      }
      if (!['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED'].includes(value.status)) {
        throw new Error('fal returned an unknown video task status. Resume only after investigating the task.');
      }
      if (status !== value.status) {
        status = value.status;
        await onStatus(status);
      }
      if (status === 'COMPLETED') return value;
      if (status === 'FAILED' || status === 'CANCELLED') throw new Error(`fal task ${status}; no new generation was submitted.`);
      await this.sleep(Math.min(this.pollIntervalMs, Math.max(0, deadline - this.now())));
    }
    throw new Error('fal polling timed out; the remote task may still be running. Resume this job to keep polling.');
  }

  async result(task) {
    const value = await this.requestJson(trustedQueueUrl(task.responseUrl, task.requestId, false));
    if (!value.video?.url) throw new Error('fal completed without a video URL.');
    return { url: publicHttpsUrl(value.video.url), contentType: value.video.content_type ?? 'video/mp4' };
  }

  async download(video) {
    // Media downloads never receive FAL_KEY, even if hosted outside fal's CDN.
    const response = await this.fetch(publicHttpsUrl(video.url), {
      redirect: 'error', signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    if (!response.ok) throw new Error(`Video download failed (HTTP ${response.status}); resume to retry the download.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assertMp4(bytes);
    return bytes;
  }

  async requestJson(url, options = {}, remainingMs = this.requestTimeoutMs) {
    if (!this.apiKey) throw new Error('FAL_KEY is required for video generation or resuming a remote job.');
    if (new URL(url).origin !== QUEUE_ORIGIN) throw new Error('Refusing to send fal credentials outside queue.fal.run.');
    const response = await this.fetch(url, {
      ...options,
      redirect: 'error',
      headers: { authorization: `Key ${this.apiKey}`, ...(options.body ? { 'content-type': 'application/json' } : {}) },
      signal: AbortSignal.timeout(Math.max(1, Math.min(this.requestTimeoutMs, Math.ceil(remainingMs)))),
    });
    if (!response.ok) {
      // Keep diagnostic fields only: raw bodies can echo media and signed URLs.
      let diagnostics = [];
      try { diagnostics = safeProviderDiagnostics(await response.json(), this.apiKey); } catch { /* HTTP status remains useful. */ }
      const summary = diagnostics.map((item) => `${item.type}: ${item.message}`).join('; ');
      const error = new Error(`fal video request failed (HTTP ${response.status})${summary ? `: ${summary}` : '.'}`);
      error.statusCode = response.status;
      error.diagnostics = diagnostics;
      throw error;
    }
    try { return await response.json(); } catch { throw new Error('fal returned invalid JSON.'); }
  }
}

export function safeProviderDiagnostics(body, apiKey = '') {
  const entries = Array.isArray(body?.detail) ? body.detail : [{ type: 'provider_error', msg: body?.message ?? body?.detail ?? body?.error?.message }];
  const clean = (value) => {
    let text = typeof value === 'string' ? value : '';
    if (apiKey) text = text.replaceAll(apiKey, '[REDACTED]');
    return text.replace(/data:[^\s"']+/gi, '[MEDIA]')
      .replace(/https?:[^\s"']+/gi, '[URL]')
      .replace(/\b(?:Bearer|Key)\s+\S+/gi, '[AUTH]')
      .replace(/[A-Za-z0-9+/=_-]{80,}/g, '[DATA]')
      .replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 400);
  };
  return entries.slice(0, 5).map((entry) => ({
    type: typeof entry?.type === 'string' && /^[a-zA-Z0-9_.-]{1,80}$/.test(entry.type) && !(apiKey && entry.type.includes(apiKey)) ? entry.type : 'provider_error',
    location: Array.isArray(entry?.loc) ? entry.loc.filter((part) => typeof part === 'string' && /^[a-zA-Z0-9_.-]{1,60}$/.test(part) && !(apiKey && part.includes(apiKey))).slice(0, 6) : [],
    message: clean(entry?.msg),
  })).filter((entry) => entry.message);
}

export function videoPayload(request) {
  if (!FAL_VIDEO_MODELS[request.mode]) throw new Error('mode must be image-to-video or motion-control.');
  if (typeof request.prompt !== 'string' || !request.prompt.trim()) throw new Error('A non-empty prompt is required.');
  const image = mediaUrl(request.image, 'image');
  if (request.mode === 'image-to-video') {
    if (request.motion) throw new Error('motion is only supported by motion-control.');
    const duration = Number(request.duration ?? 5);
    if (!Number.isInteger(duration) || duration < 3 || duration > 15) throw new Error('duration must be an integer from 3 to 15 seconds.');
    return {
      prompt: request.prompt, start_image_url: image, duration: String(duration), generate_audio: false,
      ...(request.endImage ? { end_image_url: mediaUrl(request.endImage, 'image') } : {}),
    };
  }
  if (request.endImage) throw new Error('end-image is only supported by image-to-video.');
  if (request.duration !== undefined) throw new Error('motion-control duration comes from its driving video; omit duration.');
  const orientation = request.orientation ?? 'video';
  if (!['image', 'video'].includes(orientation)) throw new Error('orientation must be image or video.');
  return { prompt: request.prompt, image_url: image, video_url: mediaUrl(request.motion, 'video'), character_orientation: orientation, keep_original_sound: false };
}

export function trustedQueueUrl(value, requestId, status) {
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(requestId)) throw new Error('Invalid persisted request ID.');
  const url = new URL(value);
  const suffix = `/requests/${requestId}${status ? '/status' : ''}`;
  if (url.origin !== QUEUE_ORIGIN || url.username || url.password || url.hash || url.search
    || !url.pathname.startsWith('/fal-ai/kling-video/') || !url.pathname.endsWith(suffix)) {
    throw new Error('Refusing untrusted fal task URL.');
  }
  return url.href;
}

export function publicHttpsUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash
    || url.hostname === 'localhost' || url.hostname.endsWith('.localhost')
    || url.hostname.endsWith('.local') || url.hostname.includes(':') || /^[\d.]+$/.test(url.hostname)) {
    throw new Error('Media URL must be public HTTPS without credentials or a custom port.');
  }
  return url.href;
}

function mediaUrl(value, type) {
  if (typeof value !== 'string' || !value) throw new Error(`A ${type} reference is required.`);
  if (new RegExp(`^data:${type}/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/]+=*$`).test(value)) return value;
  return publicHttpsUrl(value);
}

export function assertMp4(bytes) {
  if (bytes.length < 12 || bytes.toString('ascii', 4, 8) !== 'ftyp') throw new Error('Video response is not an MP4 file.');
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(Number(value)) || Number(value) < 1) throw new Error(`${name} must be a positive integer.`);
  return Number(value);
}
