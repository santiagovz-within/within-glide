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


const models = load('src/lib/api/models.ts');
const gpt = load('src/lib/gptImage26.ts');
const model = models.MODELS['gpt-image-2-6'];

test('GPT Image 2.6 replaces 2.5 in the dropdown while preserving historical metadata', () => {
  assert.equal(models.IMAGE_MODELS[0].id, model.id);
  assert.equal(models.IMAGE_MODELS.some(m => m.id === 'gpt-image-2-5'), false);
  assert.equal(model.name, 'GPT Image 2.6');
  assert.equal(models.MODELS['gpt-image-2-5'].name, 'GPT Image 2.5');
  assert.equal(gpt.currentImageModel('gpt-image-2-5'), model.id);
  assert.equal(models.getImageReferenceLimit(model.id), 16);
});

for (const edit of [false, true]) {
  for (const outputFormat of ['png', 'jpeg', 'gif']) {
    test(`${edit ? 'edit' : 'text-to-image'} supports ${outputFormat} across all offered dimensions`, async () => {
      const route = routeHarness('src/app/api/fal/generate/route.ts');
      const refs = edit ? ['https://example.com/ref.png'] : [];
      for (const aspectRatio of model.supportedAspectRatios) {
        for (const resolution of model.supportedResolutions) {
          const response = await route.post({ model: model.id, prompt: 'Animate a cat waving.', aspectRatio,
            resolution, outputFormat, referenceImageUrls: refs, sourceType: 'canvas' });
          assert.equal(response.status, 200);
          const queued = route.submitted.at(-1);
          assert.equal(queued.endpoint, `openai/gpt-image-2.6/sunburst/${edit ? 'edit' : 'text-to-image'}`);
          assert.equal(queued.input.output_format, outputFormat);
          assert.deepEqual(queued.input.image_urls, edit ? refs : undefined);
          const { width, height } = queued.input.image_size;
          assert.equal(width % 16, 0);
          assert.equal(height % 16, 0);
          const [w, h] = aspectRatio.split(':').map(Number);
          assert.ok(Math.abs(width / height - w / h) / (w / h) < 0.04);
          if (outputFormat === 'gif') {
            assert.equal(queued.input.frame_count, 9);
            assert.equal(queued.input.frame_duration_ms, 200);
            assert.ok(width * height * 9 >= 655360 && width * height * 9 <= 8294400);
            assert.ok(width * 3 <= 3840 && height * 3 <= 3840);
            assert.equal(route.rows.at(-1).parameters.frameCount, 9);
          } else {
            assert.equal(queued.input.frame_count, undefined);
            assert.equal(queued.input.frame_duration_ms, undefined);
            assert.ok(width * height >= 655360 && width * height <= 8294400);
          }
          assert.equal(route.rows.at(-1).parameters.outputFormat, outputFormat);
        }
      }
    });
  }
}

test('saved 2.5 requests upgrade to 2.6 with PNG default and retain ordered reference limits', async () => {
  const route = routeHarness('src/app/api/fal/generate/route.ts');
  const refs = Array.from({ length: 17 }, (_, i) => `https://example.com/${i}.png`);
  const response = await route.post({ model: 'gpt-image-2-5', prompt: 'A cat', numImages: 2,
    referenceImageUrls: refs, sourceType: 'canvas' });
  assert.equal(response.status, 200);
  assert.equal(route.submitted.length, 2);
  for (const queued of route.submitted) {
    assert.equal(queued.endpoint, 'openai/gpt-image-2.6/sunburst/edit');
    assert.equal(queued.input.output_format, 'png');
    assert.deepEqual(queued.input.image_urls, refs.slice(0, 16));
  }
  for (const row of route.rows) assert.equal(row.model, model.id);
});

test('invalid format and dimensions fail before any paid submission', async () => {
  const route = routeHarness('src/app/api/fal/generate/route.ts');
  for (const invalid of [{ outputFormat: 'svg' }, { outputFormat: null }, { aspectRatio: '4:1' }, { resolution: '8K' }]) {
    const response = await route.post({ model: model.id, prompt: 'A cat', sourceType: 'canvas', ...invalid });
    assert.equal(response.status, 400);
  }
  assert.equal(route.submitted.length, 0);
});

test('other image models receive no GPT-only format or frame fields', async () => {
  const route = routeHarness('src/app/api/fal/generate/route.ts');
  const response = await route.post({ model: 'seedream-5', prompt: 'A cat', outputFormat: 'gif', sourceType: 'canvas' });
  assert.equal(response.status, 200);
  assert.equal(route.submitted[0].input.output_format, undefined);
  assert.equal(route.submitted[0].input.frame_count, undefined);
});

test('GIF signing returns the animated original without flattened derivatives', async () => {
  const signed = [];
  const route = load('src/app/api/media/sign/route.ts', {
    'next/server': { NextResponse: { json: Response.json } },
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) } }) },
    '@/lib/gcs': {
      isGcsRef: source => source.startsWith('gcs:'),
      getSignedReadUrl: async path => { signed.push(path); return `https://example.com/${path}`; },
    },
    '@/lib/utils/mediaUtils': { isSignedGcsUrl: () => false },
    '@/lib/mediaVariants': { hasMediaVariants: async () => { throw new Error('GIF must not request static variants'); } },
  });
  const response = await route.POST({ json: async () => ({ assets: [{ key: 'gif', source: 'gcs:user/output.gif', kind: 'image' }] }) });
  assert.deepEqual((await response.json()).assets.gif, { original: 'https://example.com/user/output.gif' });
  assert.deepEqual(signed, ['user/output.gif']);
});

test('completed GIF uploads original bytes and a GIF MIME type even with generic CDN headers', async () => {
  const uploaded = [], updates = [];
  const gif = Buffer.from('47494638396101000100800000ffffff00000021f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b', 'hex');
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) },
    from() {
      const query = {
        select() { return query; }, eq() { return query; },
        update(value) { updates.push(value); return query; },
        maybeSingle: async () => ({ data: { id: 'gen', status: 'processing',
          parameters: { endpoint: 'openai/gpt-image-2.6/sunburst/text-to-image' } } }),
        then(resolve) { return Promise.resolve({ error: null }).then(resolve); },
      }; return query;
    },
  };
  const route = load('src/app/api/fal/status/[requestId]/route.ts', {
    'next/server': { NextResponse: { json: Response.json } },
    '@/lib/supabase/server': { createClient: async () => db },
    '@fal-ai/client': { fal: { config() {}, queue: { status: async () => ({ status: 'COMPLETED' }) } } },
    '@/lib/gcs': { getSignedReadUrl: async path => `https://example.com/${path}` },
    '@/lib/mediaDerivatives': { uploadMediaToGCS: async (bytes, path, mime) => { uploaded.push({ bytes, path, mime }); return `gcs:${path}`; } },
    '@/lib/falResult': {
      fetchFalQueueResult: async () => ({ data: { images: [{ url: 'https://provider.test/output' }] } }),
      getFalBillingColumns: async () => ({}), mergeFalBillingParameters: p => p, persistFalBillingBestEffort: async () => {},
    },
    '@/lib/generationFailures': {}, '@/lib/falRecovery': {},
  });
  const savedFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(gif, { headers: { 'content-type': 'application/octet-stream' } });
    const response = await route.GET({ nextUrl: new URL('https://example.com/api/fal/status/request?mediaType=image') },
      { params: Promise.resolve({ requestId: 'request' }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'completed');
    assert.equal(uploaded[0].path, 'user/gen.gif');
    assert.equal(uploaded[0].mime, 'image/gif');
    assert.deepEqual(Buffer.from(uploaded[0].bytes), gif);
    assert.equal(updates[0].media_url, 'gcs:user/gen.gif');
  } finally { globalThis.fetch = savedFetch; }
});
