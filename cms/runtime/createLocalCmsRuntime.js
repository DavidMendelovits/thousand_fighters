import { CharacterContentRepository } from '../repositories/CharacterContentRepository.js';
import { createCmsStorage } from '../storage/createCmsStorage.js';
import { CharacterCreationPipeline } from '../pipeline/CharacterCreationPipeline.js';
import { PipelineRegistry } from '../pipeline/PipelineRegistry.js';
import { PipelinePort } from '../pipeline/ports.js';
import {
  createLocalPublisher,
} from '../pipeline/adapters/localAdapters.js';
import { createFighterQaAdapter } from '../pipeline/adapters/createFighterQaAdapter.js';
import { createTextModelAdapter } from '../pipeline/adapters/createTextModelAdapter.js';
import { createImageGeneratorAdapter } from '../pipeline/adapters/createImageGeneratorAdapter.js';
import { createSoundGeneratorAdapter } from '../pipeline/adapters/createSoundGeneratorAdapter.js';
import { createSpriteNormalizerAdapter } from '../pipeline/adapters/createSpriteNormalizerAdapter.js';
import { createCmsChatAgent } from '../agent/createCmsChatAgent.js';
import { createCmsTools } from '../tools/createCmsTools.js';
import { createJobQueueAdapter } from '../pipeline/adapters/createJobQueueAdapter.js';

export function createLocalCmsRuntime(options = {}) {
  const storage = options.storage ?? createCmsStorage(options.storageOptions ?? {});
  const repository = options.repository ?? new CharacterContentRepository(storage);
  const registry = new PipelineRegistry({
    [PipelinePort.ASSET_STORAGE]: storage,
    [PipelinePort.CHARACTER_REPOSITORY]: repository,
    [PipelinePort.TEXT_MODEL]: options.textModel ?? createTextModelAdapter(options.textModelOptions ?? {}),
    [PipelinePort.IMAGE_GENERATOR]: options.imageGenerator ?? createImageGeneratorAdapter(options.imageGeneratorOptions ?? {}),
    [PipelinePort.SPRITE_NORMALIZER]: options.spriteNormalizer ?? createSpriteNormalizerAdapter({ storage, repository, ...options.spriteNormalizerOptions }),
    [PipelinePort.FIGHTER_QA]: options.fighterQa ?? createFighterQaAdapter({ storage, repository, ...options.fighterQaOptions }),
    [PipelinePort.PUBLISHER]: options.publisher ?? createLocalPublisher({ storage, repository }),
    [PipelinePort.SOUND_GENERATOR]: options.soundGenerator ?? createSoundGeneratorAdapter(options.soundGeneratorOptions ?? {}),
    [PipelinePort.JOB_QUEUE]: options.jobQueue ?? createJobQueueAdapter(options.jobQueueOptions ?? {}),
  });
  const pipeline = new CharacterCreationPipeline(registry);
  const tools = createCmsTools({ pipeline, repository, registry });
  const chatAgent = options.chatAgent ?? createCmsChatAgent({ tools });

  return {
    storage,
    repository,
    registry,
    pipeline,
    tools,
    chatAgent,
    gaps: currentArchitectureGaps(),
  };
}

function currentArchitectureGaps() {
  return [
    {
      id: 'contour-normalizer-adapter',
      status: 'implemented',
      title: 'Real sprite normalizer adapter',
      detail: 'ContourSpriteNormalizerAdapter wraps scripts/normalize_fighter_sheet_contours.py. Select with SPRITE_NORMALIZER_PROVIDER=contour.',
    },
    {
      id: 'fighter-qa-adapter',
      status: 'implemented',
      title: 'Real fighter QA adapter',
      detail: 'FighterPackQaAdapter validates manifest, frameData, sprite files, frame counts, anchor stability, and normalization reports. Select with FIGHTER_QA_PROVIDER=real (default) or local.',
    },
    {
      id: 'roster-import-export',
      status: 'remaining',
      title: 'Runtime roster export',
      detail: 'Existing fighter assets can be imported into the file CMS; next step is exporting CMS releases back into runtime CharacterConfig data.',
    },
    {
      id: 'production-direct-uploads',
      status: 'remaining',
      title: 'Direct browser-to-blob uploads',
      detail: 'The admin API can upload assets now, but large production sprite sheets should use signed direct uploads to R2 or Supabase Storage.',
    },
    {
      id: 'auth-and-audit',
      status: 'remaining',
      title: 'Auth, permissions, and audit trail',
      detail: 'Protect admin routes and record who changed drafts, assets, validation reports, and releases.',
    },
  ];
}
