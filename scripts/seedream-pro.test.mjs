import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(file, dependencies = {}) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const loadedModule = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(name => {
    if (name in dependencies) return dependencies[name];
    if (name.startsWith('@/')) return load(`src/${name.slice(2)}.ts`, dependencies);
    if (name.startsWith('.')) return load(path.join(path.dirname(file), `${name}.ts`), dependencies);
    return require(name);
  }, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

const models = load('src/lib/api/models.ts');
const pricing = load('src/lib/falPricing.ts');
const layerize = load('src/lib/layerize.ts');
const model = models.MODELS['seedream-5'];
const config = models.FAL_MODELS['seedream-5'];

test('Seedream 5 Pro keeps saved flow IDs and appears immediately above Nano Banana 2', () => {
  assert.equal(model.name, 'Seedream 5 Pro');
  const index = models.IMAGE_MODELS.findIndex(option => option.id === 'seedream-5');
  assert.equal(models.IMAGE_MODELS[index + 1].id, 'nano-banana-2');
  assert.equal(models.IMAGE_MODELS.filter(option => option.id === 'seedream-5').length, 1);
  assert.equal(models.getImageReferenceLimit('seedream-5'), 10);
  assert.deepEqual(models.getPromptReferenceStyle('seedream-5'), { kind: 'plain', template: 'Figure {n}' });
});

function routeHarness(file) {
  const submitted = [], rows = [];
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) },
    from(table) {
      assert.equal(table, 'generations');
      const query = {
        insert(row) { rows.push(row); return query; },
        select() { return query; },
        single: async () => ({ data: { id: `generation-${rows.length}` }, error: null }),
      };
      return query;
    },
  };
  const { POST } = load(file, {
    'next/server': { NextResponse: { json: (value, init) => Response.json(value, init) } },
    '@/lib/supabase/server': { createClient: async () => db },
    '@fal-ai/client': { fal: { config() {}, queue: { submit: async (endpoint, request) => {
      submitted.push({ endpoint, ...request }); return { request_id: `request-${submitted.length}` };
    } } } },
    '@/lib/generationAttempt': { registerGenerationAttempt: async () => {} },
    '@/lib/falStorage': { getFalStorageHeaders: async () => ({ 'test-storage': 'preserved' }) },
    '@/lib/falErrors': { describeFalError: String },
  });
  return { submitted, rows, post: body => POST({ json: async () => body }) };
}

for (const edit of [false, true]) {
  test(`Seedream 5 Pro ${edit ? 'edit' : 'text-to-image'} sends all offered aspect/resolution combinations to the Pro endpoint`, async () => {
    const route = routeHarness('src/app/api/fal/generate/route.ts');
    for (const aspectRatio of model.supportedAspectRatios) {
      for (const resolution of model.supportedResolutions) {
        const references = edit ? ['https://example.com/one.png', 'https://example.com/two.png'] : [];
        const response = await route.post({ model: model.id, prompt: 'Use Figure 1 as the subject.',
          aspectRatio, resolution, referenceImageUrls: references, sourceType: 'canvas', sourceId: 'flow', nodeId: 'node' });
        assert.equal(response.status, 200);
        const queued = route.submitted.at(-1);
        const endpoint = `bytedance/seedream/v5/pro/${edit ? 'edit' : 'text-to-image'}`;
        assert.equal(queued.endpoint, endpoint);
        const { width, height } = queued.input.image_size;
        assert.ok(Number.isInteger(width) && Number.isInteger(height));
        assert.ok(width * height >= 921_600 && width * height <= 4_624_220);
        const [w, h] = aspectRatio.split(':').map(Number);
        assert.ok(Math.abs(width / height - w / h) < 0.02);
        assert.deepEqual(queued.input, { prompt: 'Use Figure 1 as the subject.', image_size: { width, height },
          ...(edit ? { image_urls: references } : {}) });
        assert.deepEqual(queued.headers, { 'test-storage': 'preserved' });
        assert.equal((await response.json()).endpoint, endpoint);
        assert.equal(route.rows.at(-1).parameters.endpoint, endpoint);
      }
    }
  });
}

test('Seedream Pro retains ordered references and separate recoverable batch requests', async () => {
  const route = routeHarness('src/app/api/fal/generate/route.ts');
  const references = Array.from({ length: 11 }, (_, i) => `https://example.com/${i}.png`);
  const response = await route.post({ model: model.id, prompt: 'A product shot', aspectRatio: '16:9', resolution: '2K',
    numImages: 3, referenceImageUrls: references, sourceType: 'canvas' });
  assert.equal(response.status, 200);
  assert.equal(route.submitted.length, 3);
  assert.equal((await response.json()).requests.length, 3);
  for (const queued of route.submitted) assert.deepEqual(queued.input.image_urls, references.slice(0, 10));
});

test('Seedream Pro estimates both price tiers, batch totals, and live price overrides for text and edit', () => {
  for (const endpoint of [config.endpoint, config.editEndpoint]) {
    const rule = models.getFalPricingRule(endpoint);
    assert.ok(models.getFalPricingEndpointIds().includes(endpoint));
    const input = { endpoint, aspectRatio: '1:1', resolution: '1K' };
    assert.equal(pricing.estimateFalCost(undefined, rule, input), 0.0675);
    assert.equal(pricing.estimateFalCost(undefined, rule, { ...input, resolution: '2K' }), 0.135);
    assert.equal(pricing.estimateFalCost(undefined, rule, { ...input, resolution: '2K', outputCount: 3 }), 0.405);
    assert.equal(pricing.estimateFalCost({ endpointId: endpoint, currency: 'USD', unitPrice: 0.08, unit: 'image' },
      rule, { ...input, resolution: '2K' }), 0.16);
  }
});

test('Modify Layerize submits the Pro endpoint with PNG output and persists it for polling', async () => {
  const route = routeHarness('src/app/api/fal/layerize/route.ts');
  const response = await route.post({ imageUrl: 'https://example.com/source.png', sourceId: 'flow', nodeId: 'node' });
  assert.equal(response.status, 200);
  assert.equal(layerize.LAYERIZE_ENDPOINT, 'bytedance/seedream/v5/pro/layerize');
  assert.deepEqual(route.submitted[0], {
    endpoint: layerize.LAYERIZE_ENDPOINT,
    input: { image_url: 'https://example.com/source.png', prompt: 'Return name and description in English.',
      image_size: 'auto', output_format: 'png', enhance_prompt_mode: 'standard', enable_safety_checker: true },
    headers: { 'test-storage': 'preserved' },
  });
  assert.equal(route.rows[0].model, layerize.LAYERIZE_ENDPOINT);
  assert.equal(route.rows[0].parameters.endpoint, layerize.LAYERIZE_ENDPOINT);
  assert.ok(models.getFalPricingEndpointIds().includes(layerize.LAYERIZE_ENDPOINT));
  assert.equal((await route.post({ imageUrl: '' })).status, 400);
  assert.equal(route.submitted.length, 1);
});
