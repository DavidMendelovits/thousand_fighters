import { CharacterContentRepository } from '../repositories/CharacterContentRepository.js';
import { createCmsStorage } from '../storage/createCmsStorage.js';
import { CharacterCreationPipeline } from '../pipeline/CharacterCreationPipeline.js';
import { PipelineRegistry } from '../pipeline/PipelineRegistry.js';
import { PipelinePort } from '../pipeline/ports.js';
import {
  createLocalFighterQa,
  createLocalPlaceholderImageGenerator,
  createLocalPublisher,
  createLocalSpriteNormalizer,
} from '../pipeline/adapters/localAdapters.js';
import { createTextModelAdapter } from '../pipeline/adapters/createTextModelAdapter.js';
import { createCmsChatAgent } from '../agent/createCmsChatAgent.js';
import { createCmsTools } from '../tools/createCmsTools.js';

export function createLocalCmsRuntime(options = {}) {
  const storage = options.storage ?? createCmsStorage(options.storageOptions ?? {});
  const repository = options.repository ?? new CharacterContentRepository(storage);
  const registry = new PipelineRegistry({
    [PipelinePort.ASSET_STORAGE]: storage,
    [PipelinePort.CHARACTER_REPOSITORY]: repository,
    [PipelinePort.TEXT_MODEL]: options.textModel ?? createTextModelAdapter(options.textModelOptions ?? {}),
    [PipelinePort.IMAGE_GENERATOR]: options.imageGenerator ?? createLocalPlaceholderImageGenerator(),
    [PipelinePort.SPRITE_NORMALIZER]: options.spriteNormalizer ?? createLocalSpriteNormalizer({ storage, repository }),
    [PipelinePort.FIGHTER_QA]: options.fighterQa ?? createLocalFighterQa({ repository }),
    [PipelinePort.PUBLISHER]: options.publisher ?? createLocalPublisher({ storage, repository }),
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
      id: 'openai-image-adapter',
      status: 'remaining',
      title: 'OpenAI image generation adapter',
      detail: 'Replace placeholder SVG sprite sheets with gpt-image-2 generation and edit support behind imageGenerator.generateImage().',
    },
    {
      id: 'contour-normalizer-adapter',
      status: 'remaining',
      title: 'Real sprite normalizer adapter',
      detail: 'Wrap scripts/normalize_fighter_sheet_contours.py as spriteNormalizer.normalizeFighterPack().',
    },
    {
      id: 'fighter-qa-adapter',
      status: 'remaining',
      title: 'Real fighter QA adapter',
      detail: 'Implement docs/FIGHTER_PACK_QA_PLAN.md checks and make publish require a passing report.',
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
