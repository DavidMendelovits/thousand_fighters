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
  return {
    id: overrides.id ?? 'mock-normalizer',
    provider: overrides.provider ?? 'mock',
    capabilities: ['fighter-pack-normalization'],
    async healthCheck() {
      return { status: 'ok', message: 'Mock normalizer is available.' };
    },
    async normalizeFighterPack(request) {
      return {
        status: 'pass',
        provider: 'mock',
        characterId: request.characterId,
        outputKey: `characters/${request.characterId}/normalized/manifest.json`,
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
