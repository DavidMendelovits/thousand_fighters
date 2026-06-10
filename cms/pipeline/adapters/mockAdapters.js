export function createMockTextModel(overrides = {}) {
  return {
    id: overrides.id ?? 'mock-text-model',
    provider: overrides.provider ?? 'mock',
    capabilities: ['structured-output'],
    async healthCheck() {
      return { status: 'ok', message: 'Mock text model is available.' };
    },
    async completeStructured(request) {
      return {
        provider: 'mock',
        promptRef: `mock://${request.task}`,
        value: {
          displayName: request.input?.brief ? `Draft ${request.input.characterId}` : request.input.characterId,
          description: request.input?.brief ?? '',
          stats: {
            walkForwardSpeed: 3,
            walkBackSpeed: 2,
            maxHealth: 1000,
          },
          sprite: {
            frameCounts: {
              base: 6,
              punch: 6,
              kick: 6,
              special_1: 6,
              special_2: 6,
            },
          },
          moves: [],
        },
      };
    },
  };
}

export function createMockImageGenerator(overrides = {}) {
  return {
    id: overrides.id ?? 'mock-image-generator',
    provider: overrides.provider ?? 'mock',
    capabilities: ['fighter-5x6-sheet'],
    async healthCheck() {
      return { status: 'ok', message: 'Mock image generator is available.' };
    },
    async generateImage(request) {
      return {
        provider: 'mock',
        model: 'mock-image-model',
        promptRef: `mock://${request.task}`,
        contentType: 'image/png',
        bytes: Buffer.from(`mock image for ${request.prompt}`),
      };
    },
  };
}

export function createMockNormalizer(overrides = {}) {
  const storage = overrides.storage ?? null;
  const SHEETS = ['base', 'punch', 'kick', 'special_1', 'special_2'];
  return {
    id: overrides.id ?? 'mock-normalizer',
    provider: overrides.provider ?? 'mock',
    capabilities: ['fighter-pack-normalization'],
    async healthCheck() {
      return { status: 'ok', message: 'Mock normalizer is available.' };
    },
    async normalizeFighterPack(request) {
      const characterId = request.characterId;
      const assetRootKey = `characters/${characterId}/assets/fighter-pack`;
      const outputKey = `${assetRootKey}/manifest.json`;
      const frameDataKey = `${assetRootKey}/frameData.json`;

      // Honor the same storage contract as the real normalizers: a canonical
      // manifest.json + frameData.json pair lands under the fighter pack root.
      if (storage) {
        const manifest = {
          id: characterId,
          artSource: 'mock',
          frameData: 'frameData.json',
          sheets: Object.fromEntries(SHEETS.map((s) => [s, `sheets/${s}.png`])),
          sprites: Object.fromEntries(
            SHEETS.map((s) => [s, Array.from({ length: 6 }, (_, i) => `sprites/${s}/${s}_${String(i + 1).padStart(3, '0')}.png`)]),
          ),
          frameCounts: Object.fromEntries(SHEETS.map((s) => [s, 6])),
        };
        const frameData = {
          anchorConvention: 'frame anchor is the character pivot/feet, in pixels from each PNG top-left',
          frames: Object.fromEntries(
            SHEETS.map((s) => [
              s,
              Array.from({ length: 6 }, (_, i) => ({
                file: `sprites/${s}/${s}_${String(i + 1).padStart(3, '0')}.png`,
                width: 256,
                height: 256,
                anchor: { x: 128, y: 240 },
              })),
            ]),
          ),
        };
        await storage.putJson(outputKey, manifest, { contentType: 'application/json', artifactType: 'normalized-manifest' });
        await storage.putJson(frameDataKey, frameData, { contentType: 'application/json', artifactType: 'frame-data' });
      }

      return {
        status: 'pass',
        provider: 'mock',
        characterId,
        outputKey,
        frameDataKey,
        assetRootKey,
      };
    },
  };
}

export function createMockQa(overrides = {}) {
  return {
    id: overrides.id ?? 'mock-fighter-qa',
    provider: overrides.provider ?? 'mock',
    capabilities: ['fighter-pack-validation'],
    async healthCheck() {
      return { status: 'ok', message: 'Mock fighter QA is available.' };
    },
    async validateFighterPack(request) {
      return {
        status: 'pass',
        provider: 'mock',
        characterId: request.characterId,
        checks: [],
      };
    },
  };
}

export function createMockSoundGenerator(overrides = {}) {
  const calls = [];
  return {
    id: overrides.id ?? 'mock-sound-generator',
    provider: overrides.provider ?? 'mock',
    capabilities: ['audio-generation', 'sfx', 'bgm'],
    calls,
    async healthCheck() {
      return { status: 'ok', message: 'Mock sound generator is available.' };
    },
    async generateAudio(request) {
      calls.push({ ...request });
      return {
        provider: 'mock',
        model: 'mock-sound-model',
        contentType: 'audio/wav',
        base64: Buffer.from(`mock audio for ${request.prompt ?? ''}`).toString('base64'),
        promptRef: `mock://${request.task ?? 'audio'}`,
      };
    },
  };
}

export function createMockJobQueue(overrides = {}) {
  const jobs = new Map();
  return {
    id: overrides.id ?? 'mock-job-queue',
    provider: overrides.provider ?? 'mock',
    capabilities: ['job-queue', 'in-memory'],
    jobs,
    async healthCheck() {
      return { status: 'ok', message: 'Mock job queue is available.' };
    },
    async enqueue(job) {
      const jobId = `mock-job-${jobs.size + 1}`;
      const record = {
        id: jobId,
        status: 'pending',
        type: job.type ?? 'unknown',
        input: job.input ?? {},
        result: null,
        error: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
      };
      jobs.set(jobId, record);
      const promise = Promise.resolve().then(async () => {
        record.status = 'running';
        try {
          record.result = await job.execute(job.input);
          record.status = 'completed';
        } catch (err) {
          record.error = err.message ?? String(err);
          record.status = 'failed';
        }
        record.completedAt = new Date().toISOString();
        return record;
      });
      return { jobId, status: 'pending', promise };
    },
    async getJob(jobId) {
      return jobs.get(jobId) ?? null;
    },
  };
}

export function createMockPublisher(overrides = {}) {
  return {
    id: overrides.id ?? 'mock-publisher',
    provider: overrides.provider ?? 'mock',
    capabilities: ['character-publish'],
    async healthCheck() {
      return { status: 'ok', message: 'Mock publisher is available.' };
    },
    async publishCharacter(request) {
      return {
        status: 'published',
        provider: 'mock',
        characterId: request.characterId,
        releaseId: request.releaseId ?? 'mock-release',
      };
    },
  };
}
