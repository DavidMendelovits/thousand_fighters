export const PipelinePort = Object.freeze({
  ASSET_STORAGE: 'assetStorage',
  CHARACTER_REPOSITORY: 'characterRepository',
  TEXT_MODEL: 'textModel',
  IMAGE_GENERATOR: 'imageGenerator',
  VIDEO_GENERATOR: 'videoGenerator',
  SPRITE_NORMALIZER: 'spriteNormalizer',
  FIGHTER_QA: 'fighterQa',
  PUBLISHER: 'publisher',
  JOB_QUEUE: 'jobQueue',
});

export const PortMethods = Object.freeze({
  [PipelinePort.ASSET_STORAGE]: ['getJson', 'putJson', 'getBytes', 'putBytes', 'getMetadata', 'exists', 'list', 'delete', 'urlFor'],
  [PipelinePort.CHARACTER_REPOSITORY]: ['listCharacters', 'getDraft', 'saveDraft', 'createVersion', 'writeAsset', 'writeQaReport'],
  [PipelinePort.TEXT_MODEL]: ['completeStructured'],
  [PipelinePort.IMAGE_GENERATOR]: ['generateImage'],
  [PipelinePort.VIDEO_GENERATOR]: ['generateVideo'],
  [PipelinePort.SPRITE_NORMALIZER]: ['normalizeFighterPack'],
  [PipelinePort.FIGHTER_QA]: ['validateFighterPack'],
  [PipelinePort.PUBLISHER]: ['publishCharacter'],
  [PipelinePort.JOB_QUEUE]: ['enqueue', 'getJob'],
});

export function assertPortAdapter(port, adapter) {
  const methods = PortMethods[port];
  if (!methods) {
    throw new Error(`Unknown pipeline port: ${port}`);
  }
  if (!adapter || typeof adapter !== 'object') {
    throw new TypeError(`Adapter for ${port} must be an object.`);
  }

  const missing = methods.filter((method) => typeof adapter[method] !== 'function');
  if (missing.length > 0) {
    throw new Error(`Adapter for ${port} is missing required method(s): ${missing.join(', ')}`);
  }
}

export function adapterDescriptor(port, adapter) {
  return {
    port,
    id: adapter.id ?? port,
    provider: adapter.provider ?? 'unknown',
    capabilities: adapter.capabilities ?? [],
  };
}

export async function adapterHealth(port, adapter) {
  const descriptor = adapterDescriptor(port, adapter);
  if (typeof adapter.healthCheck !== 'function') {
    return {
      ...descriptor,
      status: 'unknown',
      message: 'Adapter does not expose a health check yet.',
    };
  }

  try {
    const health = await adapter.healthCheck();
    return {
      ...descriptor,
      status: health.status ?? 'unknown',
      message: health.message ?? '',
      details: health.details ?? {},
    };
  } catch (error) {
    return {
      ...descriptor,
      status: 'error',
      message: error.message ?? 'Health check failed.',
      details: {},
    };
  }
}
