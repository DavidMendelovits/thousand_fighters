import assert from 'node:assert/strict';
import { createImageGeneratorAdapter } from '../cms/pipeline/adapters/createImageGeneratorAdapter.js';
import { OpenAiResponsesImageGeneratorAdapter } from '../cms/pipeline/adapters/openAiResponsesImageGeneratorAdapter.js';

const fakePngBytes = Buffer.from('fake-png-bytes');
let capturedRequest;

const adapter = new OpenAiResponsesImageGeneratorAdapter({
  apiKey: 'test-key',
  model: 'gpt-test-mainline',
  imageModel: 'gpt-image-test',
  size: '1024x1024',
  quality: 'low',
  background: 'opaque',
  outputFormat: 'png',
  fetch: async (url, options) => {
    capturedRequest = {
      url,
      body: JSON.parse(options.body),
      authorization: options.headers.authorization,
    };
    return new Response(JSON.stringify({
      id: 'resp_test_image_model',
      model: 'gpt-test-mainline',
      output: [
        {
          id: 'ig_test_123',
          type: 'image_generation_call',
          status: 'completed',
          model: 'gpt-image-test',
          output_format: 'png',
          revised_prompt: 'A revised fighter sprite sheet prompt.',
          result: fakePngBytes.toString('base64'),
        },
      ],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  },
});

const health = await adapter.healthCheck();
assert.equal(health.status, 'ok');
assert.equal(health.details.imageModel, 'gpt-image-test');

const result = await adapter.generateImage({
  task: 'fighter-5x6-sheet',
  prompt: 'A test fighter with readable punch, kick, and specials.',
  referenceAssetKeys: ['characters/test/assets/source/reference.png'],
  context: {
    characterId: 'image_test',
  },
});

assert.equal(result.provider, 'openai');
assert.equal(result.model, 'gpt-image-test');
assert.equal(result.promptRef, 'resp_test_image_model');
assert.equal(result.imageGenerationId, 'ig_test_123');
assert.equal(result.revisedPrompt, 'A revised fighter sprite sheet prompt.');
assert.equal(result.contentType, 'image/png');
assert.equal(Buffer.from(result.base64, 'base64').toString('utf8'), fakePngBytes.toString('utf8'));

assert.equal(capturedRequest.authorization, 'Bearer test-key');
assert.match(capturedRequest.url, /\/responses$/);
assert.equal(capturedRequest.body.model, 'gpt-test-mainline');
assert.deepEqual(capturedRequest.body.tool_choice, { type: 'image_generation' });
assert.equal(capturedRequest.body.tools[0].type, 'image_generation');
assert.equal(capturedRequest.body.tools[0].model, 'gpt-image-test');
assert.equal(capturedRequest.body.tools[0].size, '1024x1024');
assert.equal(capturedRequest.body.tools[0].quality, 'low');
assert.equal(capturedRequest.body.tools[0].background, 'opaque');
assert.equal(capturedRequest.body.tools[0].output_format, 'png');
assert.match(capturedRequest.body.input, /Exactly 5 rows and 6 columns/);
assert.match(capturedRequest.body.input, /chroma-magenta/);
assert.match(capturedRequest.body.input, /characters\/test\/assets\/source\/reference\.png/);

const factoryAdapter = createImageGeneratorAdapter({
  provider: 'openai',
  apiKey: 'test-key',
  model: 'gpt-test-mainline',
  imageModel: 'gpt-image-test',
  fetch: adapter.fetch,
});
assert.equal(factoryAdapter.provider, 'openai');
assert.equal(factoryAdapter.id, 'openai-responses-image-generator');

console.log('OpenAI Responses image generator smoke test passed.');
