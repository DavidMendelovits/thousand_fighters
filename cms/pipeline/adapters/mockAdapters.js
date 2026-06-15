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
            // Canonical 5 declared at creation; walk/grab/throw counts flow in
            // from the manifest once those rows are generated (see buildSpriteConfig).
            frameCounts: {
              base: 6,
              punch: 6,
              kick: 6,
              special_1: 6,
              special_2: 6,
            },
          },
          moves: [
            {
              id: 'jab',
              displayName: 'Jab',
              animation: 'punch',
              description: 'Quick standing jab.',
              trigger: { allowedStates: ['idle', 'walk_forward', 'walk_back'], sequence: ['lp'] },
              phases: [
                { name: 'startup', frames: 4, events: [] },
                {
                  name: 'active',
                  frames: 3,
                  events: [
                    {
                      onFrame: 0,
                      event: {
                        type: 'hitbox_active',
                        hitbox: { x: 30, y: -100, width: 60, height: 36, damage: 50, hitstun: 14, blockstun: 8, knockback: { x: 3, y: 0 } },
                      },
                    },
                    { onFrame: 0, event: { type: 'play_sound', name: 'hit' } },
                  ],
                },
                { name: 'recovery', frames: 7, events: [] },
              ],
            },
            {
              id: 'cross',
              displayName: 'Cross',
              animation: 'punch',
              description: 'Straight cross follow-up.',
              trigger: { allowedStates: ['idle'], sequence: ['mp'], cancelFrom: ['jab'] },
              phases: [
                { name: 'startup', frames: 6, events: [] },
                {
                  name: 'active',
                  frames: 3,
                  events: [
                    {
                      onFrame: 0,
                      event: {
                        type: 'hitbox_active',
                        hitbox: { x: 34, y: -104, width: 64, height: 38, damage: 70, hitstun: 18, blockstun: 10, knockback: { x: 4, y: 0 } },
                      },
                    },
                  ],
                },
                { name: 'recovery', frames: 9, events: [] },
              ],
            },
            {
              id: 'roundhouse',
              displayName: 'Roundhouse',
              animation: 'kick',
              description: 'Spinning kick with knockdown.',
              trigger: { allowedStates: ['idle'], sequence: ['hk'] },
              phases: [
                { name: 'startup', frames: 8, events: [] },
                {
                  name: 'active',
                  frames: 4,
                  events: [
                    {
                      onFrame: 0,
                      event: {
                        type: 'hitbox_active',
                        hitbox: { x: 36, y: -110, width: 70, height: 44, damage: 90, hitstun: 22, blockstun: 14, knockback: { x: 5, y: 0 }, knockdown: true },
                      },
                    },
                  ],
                },
                { name: 'recovery', frames: 12, events: [] },
              ],
            },
            {
              id: 'fireball',
              displayName: 'Fireball',
              animation: 'special_1',
              description: 'Throws a fireball projectile.',
              trigger: { allowedStates: ['idle'], sequence: ['down', 'forward', 'lp'] },
              phases: [
                { name: 'startup', frames: 8, events: [] },
                {
                  name: 'active',
                  frames: 4,
                  events: [
                    {
                      onFrame: 0,
                      event: { type: 'spawn_projectile', hitbox: null, projectile: null, projectileId: 'fireball_proj', offsetX: 50, offsetY: -90 },
                    },
                  ],
                },
                { name: 'recovery', frames: 14, events: [] },
              ],
            },
            {
              id: 'command_grab',
              displayName: 'Command Grab',
              animation: 'grab',
              description: 'Grab the opponent up close.',
              trigger: { allowedStates: ['idle'], sequence: ['lp', 'lk'] },
              phases: [
                { name: 'startup', frames: 5, events: [] },
                {
                  name: 'active',
                  frames: 3,
                  events: [
                    {
                      onFrame: 0,
                      event: {
                        type: 'hitbox_active',
                        hitbox: { x: 24, y: -96, width: 40, height: 80, damage: 40, hitstun: 30, blockstun: 0, knockback: { x: 0, y: 0 } },
                      },
                    },
                  ],
                },
                { name: 'recovery', frames: 10, events: [] },
              ],
            },
            {
              id: 'suplex',
              displayName: 'Suplex',
              animation: 'throw',
              description: 'Throw follow-up after a grab.',
              trigger: { allowedStates: ['idle'], sequence: ['hp'] },
              phases: [
                { name: 'startup', frames: 4, events: [] },
                {
                  name: 'active',
                  frames: 4,
                  events: [
                    {
                      onFrame: 0,
                      event: {
                        type: 'hitbox_active',
                        hitbox: { x: 20, y: -100, width: 60, height: 60, damage: 110, hitstun: 24, blockstun: 0, knockback: { x: 6, y: -4 }, knockdown: true },
                      },
                    },
                  ],
                },
                { name: 'recovery', frames: 16, events: [] },
              ],
            },
          ],
          combos: [
            { id: 'jab_cross', displayName: 'Jab → Cross', segments: ['jab', 'cross'] },
            { id: 'grab_suplex', displayName: 'Command Grab → Suplex', segments: ['command_grab', 'suplex'] },
          ],
          projectiles: [
            {
              id: 'fireball_proj',
              width: 48,
              height: 24,
              speed: 8,
              velocity: { x: 8, y: 0, relativeToFacing: true },
              lifetime: 90,
              hitbox: { x: -24, y: -12, width: 48, height: 24, damage: 70, hitstun: 20, blockstun: 14, knockback: { x: 5, y: -2 }, level: 'mid' },
            },
          ],
        },
      };
    },
  };
}

// A real (tiny) 1x6 sprite row: 192x64, magenta background, six blue body
// blocks on a shared floor line with a growing arm — small enough to embed,
// real enough that frame extraction and anchoring work keylessly.
const MOCK_ROW_SHEET_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAMAAAABACAIAAADDDu+IAAAA4ElEQVR42u3awQmEMBBA0XGxGSuwjS3VNqzAcuLBy7KKxGDQwHtXIQPyiR6mS5ECSn28AgSEgBAQAgIBISAEhIBAQAgIASEgEBACQkAICASEgHhWf/54+M45pyzTWDbe+a2f7wbCJwwBISAEBAJCQAgIAYGAEBACQkAgIARENLQPFFfWSoq3UvLXViqN+F2LqTHib+3m9hH7tZ57RxyuDW0j3ED4hCEgBISf6FL1fp+d//Lz3UD4hCEgBISAQEAICAEhIBAQAkJACAgEhIB4lS5F8hZwAyEgBISAQEAIiCasAMIy9fniDPYAAAAASUVORK5CYII=';

export function createMockImageGenerator(overrides = {}) {
  return {
    id: overrides.id ?? 'mock-image-generator',
    provider: overrides.provider ?? 'mock',
    capabilities: ['fighter-1x6-row', 'fighter-2x3-grid'],
    async healthCheck() {
      return { status: 'ok', message: 'Mock image generator is available.' };
    },
    async generateImage(request) {
      return {
        provider: 'mock',
        model: 'mock-image-model',
        promptRef: `mock://${request.task}`,
        contentType: 'image/png',
        bytes: Buffer.from(MOCK_ROW_SHEET_BASE64, 'base64'),
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
