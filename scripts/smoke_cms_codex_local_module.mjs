import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLocalCodexCmsModule } from '../cms/codex/createLocalCodexCmsModule.js';

const rootDir = await mkdtemp(path.join(os.tmpdir(), 'thousand-fighters-codex-module-'));
const capturedRequests = [];

try {
  const module = createLocalCodexCmsModule({
    apiKey: 'test-key',
    model: 'gpt-test-codex',
    reasoningEffort: 'medium',
    runtimeOptions: {
      storageOptions: {
        provider: 'file',
        rootDir,
      },
    },
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      capturedRequests.push({
        url,
        authorization: options.headers.authorization,
        body,
      });

      if (capturedRequests.length === 1) {
        return jsonResponse({
          id: 'resp_codex_tool_request',
          status: 'completed',
          output: [
            {
              type: 'function_call',
              call_id: 'call_pipeline_status',
              name: 'get_pipeline_status',
              arguments: '{}',
            },
          ],
        });
      }

      return jsonResponse({
        id: 'resp_codex_final',
        status: 'completed',
        output_text: 'Pipeline status checked locally.',
        output: [],
      });
    },
  });

  const health = await module.healthCheck();
  assert.equal(health.agent.status, 'ok');
  assert.equal(health.agent.provider, 'openai-codex');
  assert.equal(health.agent.details.model, 'gpt-test-codex');
  assert.equal(health.functions.some((tool) => tool.name === 'generate_sprite_sheet'), true);

  const tools = module.listFunctions();
  assert.equal(tools.some((tool) => tool.name === 'get_pipeline_status'), true);

  const draftResult = await module.invokeFunction('create_character_draft', {
    characterId: 'codex_module_test',
    brief: 'A deterministic local draft created by direct function invocation.',
  });
  assert.equal(draftResult.draft.id, 'codex_module_test');

  const result = await module.run('Check pipeline status.');
  assert.equal(result.provider, 'openai-codex');
  assert.equal(result.agentId, 'openai-codex-cms-local-agent');
  assert.equal(result.message, 'Pipeline status checked locally.');
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].name, 'get_pipeline_status');
  assert.equal(result.toolCalls[0].status, 'success');

  assert.equal(capturedRequests.length, 2);
  assert.equal(capturedRequests[0].authorization, 'Bearer test-key');
  assert.match(capturedRequests[0].url, /\/responses$/);
  assert.equal(capturedRequests[0].body.model, 'gpt-test-codex');
  assert.deepEqual(capturedRequests[0].body.reasoning, { effort: 'medium' });
  assert.equal(capturedRequests[0].body.tools.some((tool) => tool.name === 'get_pipeline_status'), true);
  assert.equal(capturedRequests[1].body.previous_response_id, 'resp_codex_tool_request');
  assert.equal(capturedRequests[1].body.input[0].type, 'function_call_output');
  assert.match(capturedRequests[1].body.input[0].output, /adapterHealth/);

  console.log(`CMS Codex local module smoke test passed: ${rootDir}`);
} finally {
  await rm(rootDir, { force: true, recursive: true });
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
