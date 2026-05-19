export class LocalCmsChatAgent {
  constructor(options = {}) {
    if (!options.tools) throw new Error('LocalCmsChatAgent requires CMS tools.');
    this.tools = options.tools;
    this.id = 'local-cms-chat-agent';
    this.provider = 'local';
    this.capabilities = ['tool-routing', 'deterministic-fallback'];
  }

  async healthCheck() {
    return {
      status: 'warning',
      message: 'Local deterministic chat fallback is active. Set OPENAI_API_KEY and CMS_CHAT_PROVIDER=openai for model-driven tool use.',
      details: {
        provider: this.provider,
      },
    };
  }

  async chat(request = {}) {
    const message = String(request.message ?? '').trim();
    if (!message) {
      return this.response('Tell me what to change in the character CMS.', []);
    }

    const toolCalls = [];
    const lower = message.toLowerCase();
    const explicitCharacterId = extractCharacterId(message);
    const currentCharacterId = request.characterId || explicitCharacterId;

    if (lower.includes('create') || lower.includes('new draft') || lower.includes('draft a')) {
      const characterId = explicitCharacterId || currentCharacterId || 'chat_test_fighter';
      const brief = extractBrief(message) || message;
      toolCalls.push(await this.invoke('create_character_draft', { characterId, brief }));
      return this.response(`I created or replaced the draft for ${characterId}.`, toolCalls);
    }

    if (lower.includes('update') || lower.includes('change') || lower.includes('set ') || lower.includes('rename')) {
      const characterId = requireCharacterId(currentCharacterId);
      const patch = patchFromMessage(message);
      if (Object.keys(patch).length === 0) {
        return this.response(`I need a specific field to update for ${characterId}.`, toolCalls);
      }
      toolCalls.push(await this.invoke('update_character_draft', { characterId, patch }));
      return this.response(`I updated the draft for ${characterId}.`, toolCalls);
    }

    if (lower.includes('status') || lower.includes('health') || lower.includes('pipeline')) {
      toolCalls.push(await this.invoke('get_pipeline_status', {}));
      return this.response('I checked the pipeline health and adapter status.', toolCalls);
    }

    if (lower.includes('roster') || lower.includes('list characters') || lower.includes('all characters')) {
      toolCalls.push(await this.invoke('list_characters', {}));
      return this.response('I pulled the current CMS roster.', toolCalls);
    }

    if ((lower.includes('asset') || lower.includes('sprite')) && (lower.includes('show') || lower.includes('list') || lower.includes('inspect'))) {
      const characterId = requireCharacterId(currentCharacterId);
      toolCalls.push(await this.invoke('get_character_assets', { characterId }));
      return this.response(`I inspected assets for ${characterId}.`, toolCalls);
    }

    if (lower.includes('generate') && (lower.includes('sheet') || lower.includes('sprite'))) {
      const characterId = requireCharacterId(currentCharacterId);
      toolCalls.push(await this.invoke('generate_sprite_sheet', {
        characterId,
        prompt: message,
      }));
      return this.response(`I generated a source sprite sheet for ${characterId}.`, toolCalls);
    }

    if (lower.includes('normalize')) {
      const characterId = requireCharacterId(currentCharacterId);
      const sourceAssetKey = request.sourceAssetKey || extractStorageKey(message);
      if (!sourceAssetKey) {
        return this.response(`I need a source asset key before I can normalize ${characterId}.`, toolCalls);
      }
      toolCalls.push(await this.invoke('normalize_sprite_pack', { characterId, sourceAssetKey }));
      return this.response(`I normalized the sprite pack for ${characterId}.`, toolCalls);
    }

    if (lower.includes('validate') || lower.includes('qa')) {
      const characterId = requireCharacterId(currentCharacterId);
      const normalizedKey = request.normalizedKey || extractStorageKey(message);
      if (!normalizedKey) {
        return this.response(`I need a normalized manifest key before I can validate ${characterId}.`, toolCalls);
      }
      toolCalls.push(await this.invoke('validate_fighter_pack', { characterId, normalizedKey }));
      return this.response(`I ran fighter QA for ${characterId}.`, toolCalls);
    }

    return this.response('I can inspect the roster, check pipeline health, create drafts, update draft fields, list assets, generate sheets, normalize packs, and run QA. Add a character id when the request targets one fighter.', toolCalls);
  }

  async invoke(name, input) {
    try {
      return {
        name,
        input,
        status: 'success',
        result: await this.tools.invoke(name, input),
      };
    } catch (error) {
      return {
        name,
        input,
        status: 'error',
        error: error.message ?? 'Tool call failed.',
      };
    }
  }

  response(message, toolCalls) {
    return {
      provider: this.provider,
      agentId: this.id,
      message,
      toolCalls,
      responseId: null,
    };
  }
}

function extractCharacterId(message) {
  const explicit = message.match(/(?:character\s+id|fighter\s+id|\bid)\s*(?:is|=|:)?\s*([a-z][a-z0-9_-]{2,})/i);
  if (explicit) return explicit[1].toLowerCase();

  const named = message.match(/(?:character|fighter)\s+(?:named|called)\s+([a-z][a-z0-9_-]{2,})/i);
  return named?.[1]?.toLowerCase() ?? '';
}

function extractBrief(message) {
  const match = message.match(/brief\s*(?:is|=|:)\s*(.+)$/i);
  return match?.[1]?.trim() ?? '';
}

function extractStorageKey(message) {
  const match = message.match(/characters\/[a-z0-9_-]+\/assets\/[^\s"'`]+/i);
  return match?.[0] ?? '';
}

function patchFromMessage(message) {
  const patch = {};
  const displayName = extractValue(message, /display\s*name/i) ?? extractValue(message, /name/i);
  const description = extractValue(message, /description/i);
  const maxHealth = extractNumberValue(message, /(?:max\s*)?health/i);

  if (displayName) patch.displayName = displayName;
  if (description) patch.description = description;
  if (maxHealth !== null) patch.stats = { maxHealth };
  return patch;
}

function extractValue(message, labelPattern) {
  const label = labelPattern.source;
  const match = message.match(new RegExp(`${label}\\s*(?:to|=|:)\\s*([^.;\\n]+)`, 'i'));
  return match?.[1]?.trim().replace(/^["']|["']$/g, '') ?? '';
}

function extractNumberValue(message, labelPattern) {
  const label = labelPattern.source;
  const match = message.match(new RegExp(`${label}\\s*(?:to|=|:)\\s*(\\d+)`, 'i'));
  return match ? Number(match[1]) : null;
}

function requireCharacterId(characterId) {
  if (!characterId) {
    const error = new Error('A character id is required for this chat request.');
    error.statusCode = 400;
    throw error;
  }
  return characterId;
}
