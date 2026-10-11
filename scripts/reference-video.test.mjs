import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
// Compile the production modules without adding a second application bundler.
function load(path, dependencies = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const loadedModule = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(
    name => name in dependencies ? dependencies[name] : require(name), loadedModule, loadedModule.exports,
  );
  return loadedModule.exports;
}
const config = load('src/lib/api/referenceVideo.ts');
const { buildReferenceVideoInput: build, REFERENCE_VIDEO_MODELS: models } = config;
const expected = [
  ['seedance-2-5', 'bytedance/seedance-2.5/reference-to-video', 'image_urls', 'video_urls', 'generate_audio'],
  ['seedance-2', 'bytedance/seedance-2.0/reference-to-video', 'image_urls', 'video_urls', 'generate_audio'],
  ['google-omni-flash', 'google/gemini-omni-flash/v1.1/reference-to-video', 'image_urls', 'reference_video_urls', null],
  ['minimax-h3-max', 'minimax/h3-max/reference-to-video', 'reference_image_urls', 'reference_video_urls', null],
  ['wan-3-prime', 'alibaba/wan-3.0-prime/reference-to-video', 'reference_image_urls', 'reference_video_urls', 'audio'],
];
function request(model, changes = {}) {
  return { model, prompt: 'Use the subject from the image and motion from the video.',
    referenceImageUrls: ['https://example.com/a.png', 'https://example.com/b.png'],
    referenceVideoUrls: ['https://example.com/reference.mp4'], ...changes };
}
for (const [id, endpoint, imageField, videoField, audioField] of expected) {
  test(`${id}: exact reference endpoint, ordered media fields and audio mapping`, () => {
    const result = build(request(id, { referenceDuration: 5, generateAudio: false }));
    assert.equal(result.endpoint, endpoint);
    assert.deepEqual(result.input[imageField], ['https://example.com/a.png', 'https://example.com/b.png']);
    assert.deepEqual(result.input[videoField], ['https://example.com/reference.mp4']);
    assert.equal(result.input.duration, id.startsWith('seedance') ? '5' : 5);
    if (audioField) assert.equal(result.input[audioField], false);
    else {
      assert.equal('audio' in result.input, false);
      assert.equal('generate_audio' in result.input, false);
    }
    for (const key of ['image_url', 'start_image_url', 'end_image_url', 'image_style_references']) {
      assert.equal(key in result.input, false);
    }
    if (id === 'minimax-h3-max') assert.equal(result.input.prompt_expansion_mode, 'balanced');
    if (id === 'seedance-2-5') assert.equal(result.input.task, 'reference');
  });
  test(`${id}: settings boundaries, counts, incomplete references, image-only and video-only`, () => {
    const model = models.find(m => m.id === id);
    const choices = config.referenceDurationOptions(model);
    for (const referenceDuration of [choices[0], choices.at(-1)]) {
      assert.doesNotThrow(() => build(request(id, { referenceDuration })));
    }
    for (const referenceDuration of [model.minDuration - 1, model.maxDuration + 1, 5.5, '5', NaN]) {
      assert.throws(() => build(request(id, { referenceDuration })), /duration/);
    }
    for (const videoResolution of model.resolutions) assert.doesNotThrow(() => build(request(id, { videoResolution })));
    for (const aspectRatio of model.aspectRatios) assert.doesNotThrow(() => build(request(id, { aspectRatio })));
    assert.throws(() => build(request(id, { videoResolution: '8k' })), /resolution/);
    assert.throws(() => build(request(id, { aspectRatio: '5:7' })), /aspect/);
    assert.throws(() => build(request(id, { referenceImageUrls: Array(model.maxImages + 1).fill('https://example.com/a.png') })), /up to/);
    assert.throws(() => build(request(id, { referenceVideoUrls: Array(model.maxVideos + 1).fill('https://example.com/a.mp4') })), /up to/);
    assert.throws(() => build(request(id, { referenceImageUrls: [undefined] })), /valid/);
    assert.throws(() => build(request(id, { referenceVideoUrls: 'bad' })), /valid/);
    assert.throws(() => build(request(id, { referenceImageUrls: [], referenceVideoUrls: [] })), /at least one/);
    assert.throws(() => build(request(id, { prompt: ' ' })), /prompt/);
    assert.doesNotThrow(() => build(request(id, { referenceImageUrls: [] })));
    assert.doesNotThrow(() => build(request(id, { referenceVideoUrls: [] })));
  });
}
test('Curated duration menus expose only the requested times and reject Auto', () => {
  const full = [4, 5, 8, 10, 12, 15, 20, 25, 30];
  for (const id of ['seedance-2-5', 'wan-3-prime', 'seedance-2']) {
    const model = models.find(model => model.id === id);
    const expected = id === 'seedance-2' ? full.filter(seconds => seconds <= 15) : full;
    assert.deepEqual(config.referenceDurationOptions(model), expected);
    for (const referenceDuration of expected) assert.doesNotThrow(() => build(request(id, { referenceDuration })));
    for (const referenceDuration of ['auto', 2, 3, 6, 7, 9, 11, 13, 14, 16, 21, 29]) {
      assert.throws(() => build(request(id, { referenceDuration })), /duration/);
    }
    assert.equal(Number(build(request(id)).input.duration), 5);
  }
  assert.deepEqual(config.referenceDurationOptions(models.find(model => model.id === 'google-omni-flash')), [3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(config.referenceDurationOptions(models.find(model => model.id === 'minimax-h3-max')), [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  assert.throws(() => build(request('kling-3-pro')), /Unknown/);
});

const media = load('src/components/canvas/mediaOutputs.ts', { './nodes/TypedHandle': { PORT_TYPE_MAP: {} } });
const graph = load('src/components/canvas/referenceVideoInputs.ts', { './mediaOutputs': media });
test('Graph references follow edge order, current outputs, reconnects and deletions', () => {
  const nodes = [
    { id: 'a', type: 'imageGenNode', data: { generatedImages: ['a.png', 'unused.png'] } },
    { id: 'b', type: 'mediaInputNode', data: { imageUrl: 'b.png' } },
    { id: 'v', type: 'referenceVideoNode', data: { videoUrl: 'first.mp4' } },
  ];
  const edges = [
    { id: 'b-edge', source: 'b', target: 'target', targetHandle: 'reference_images' },
    { id: 'a-edge', source: 'a', target: 'target', targetHandle: 'reference_images' },
    { id: 'v-edge', source: 'v', target: 'target', targetHandle: 'reference_videos' },
  ];
  let result = graph.getReferenceVideoInputs('target', nodes, edges);
  assert.deepEqual(result.images.map(r => r.url), ['b.png', 'a.png']);
  nodes[2].data.videoUrl = 'new-version.mp4';
  result = graph.getReferenceVideoInputs('target', nodes, edges);
  assert.equal(result.videos[0].url, 'new-version.mp4');
  assert.equal(graph.getReferenceVideoInputs('target', nodes, edges.slice(1)).images.length, 1);
  assert.equal(graph.getReferenceVideoInputs('target', nodes.slice(1), edges).images[1].url, undefined);
  assert.deepEqual(media.getNodeMediaUrls(nodes[2], 'video'), ['new-version.mp4']);
});

test('API queues each reference endpoint and persists recoverable metadata; invalid calls never queue', async () => {
  const submissions = [], records = [];
  let authenticated = true;
  const supabase = {
    auth: { getUser: async () => ({ data: { user: authenticated ? { id: 'user' } : null } }) },
    from: () => ({ insert: record => { records.push(record); return { select: () => ({ single: async () => ({ data: { id: 'generation' } }) }) }; } }),
  };
  const { POST } = load('src/app/api/fal/generate/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/supabase/server': { createClient: async () => supabase },
    '@fal-ai/client': { fal: { config() {}, queue: { submit: async (endpoint, body) => { submissions.push({ endpoint, ...body }); return { request_id: 'request' }; } } } },
    '@/lib/api/models': { FAL_MODELS: Object.fromEntries(models.map(m => [m.id, { type: 'video' }])) },
    '@/lib/api/referenceVideo': config,
    '@/lib/falStorage': { getFalStorageHeaders: async () => ({ 'storage-test': 'preserved' }) },
    '@/lib/falErrors': { describeFalError: String },
    '@/lib/falPricing': {}, '@/lib/gptImage25': {},
  });
  for (const [id, endpoint] of expected) {
    const body = request(id, { generationMode: 'reference-to-video', sourceType: 'canvas', sourceId: 'flow', nodeId: 'node' });
    const response = await POST({ json: async () => body });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).endpoint, endpoint);
    assert.equal(submissions.at(-1).endpoint, endpoint);
    assert.equal(submissions.at(-1).headers['storage-test'], 'preserved');
    assert.equal(records.at(-1).parameters.endpoint, endpoint);
    assert.deepEqual(records.at(-1).parameters.referenceVideoUrls, body.referenceVideoUrls);
    assert.deepEqual(records.at(-1).reference_image_urls, body.referenceImageUrls);
    assert.equal(records.at(-1).node_id, 'node');
  }
  const count = submissions.length;
  const response = await POST({ json: async () => request('seedance-2', { generationMode: 'reference-to-video', referenceDuration: 30 }) });
  assert.equal(response.status, 400);
  authenticated = false;
  const unauthenticated = await POST({ json: async () => request('seedance-2') });
  assert.equal(unauthenticated.status, 401);
  assert.equal(submissions.length, count);
});

test('Pending-generation recovery includes the new node and keeps its original endpoint', async () => {
  const endpoint = 'minimax/h3-max/reference-to-video';
  const pending = [{ source_id: 'flow', node_id: 'node', model: 'minimax-h3-max', media_type: 'video',
    fal_request_id: 'request', parameters: { endpoint }, reference_image_urls: ['a.png'] }];
  // The user may have switched models while a request is still running.
  const flows = [{ id: 'flow', title: 'Flow', flow_data: { nodes: [{ id: 'node', type: 'referenceVideoNode', data: { model: 'seedance-2' } }] } }];
  const admin = { from: table => {
    const chain = {
      select: () => chain, eq: () => chain, not: () => chain, gte: () => chain,
      order: async () => ({ data: pending }),
      in: async () => ({ data: table === 'flows' ? flows : [] }),
    };
    return chain;
  } };
  const { GET } = load('src/app/api/generations/pending/route.ts', {
    'next/server': { NextResponse: { json: body => Response.json(body) } },
    '@/lib/supabase/server': {
      createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) } }),
      createAdminClient: () => admin,
    },
    '@/lib/api/models': { FAL_MODELS: {} },
  });
  const response = await GET();
  const { generations } = await response.json();
  assert.equal(generations.length, 1);
  assert.equal(generations[0].nodeType, 'referenceVideoNode');
  assert.equal(generations[0].endpoint, endpoint);
  assert.equal(generations[0].requestId, 'request');
});

const tags = load('src/lib/promptTags.ts');
test('Typed media tags use the shared chips and preserve independent image/video indexes', () => {
  const inputs = [
    { label: 'image1', portIndex: 0, edgeId: 'image-edge', sourceNodeId: 'image', url: 'a.png' },
    { label: 'video1', portIndex: 0, edgeId: 'video-edge', sourceNodeId: 'video', url: 'v.mp4', mediaType: 'video' },
  ];
  const text = 'Animate @image1 like @video1; ignore email@video1 and @image1suffix.';
  const live = tags.syncTagsWithText(text, [], inputs);
  assert.equal(live.length, 2);
  assert.deepEqual(tags.segmentPrompt(text, live).filter(s => s.kind === 'tag').map(s => s.text), ['@image1', '@video1']);
  assert.equal(tags.syncTagsWithText(text, live, inputs), live);
  assert.deepEqual(tags.syncTagsWithText('@video1', live, inputs).map(t => t.label), ['video1']);
  assert.equal(tags.untagLabel('@video1 and @image1', 'video1'), 'video1 and @image1');
  assert.equal(tags.compilePromptForModel('@image1', live, ['a.png']).prompt, 'the first image attached');
});

test('Tags remain tied to the same media after earlier references are removed or replaced', () => {
  const original = [
    { label: 'image1', portIndex: 0, edgeId: 'a', sourceNodeId: 'a', url: 'a.png' },
    { label: 'image2', portIndex: 1, edgeId: 'b', sourceNodeId: 'b', url: 'b.png' },
    { label: 'video1', portIndex: 0, edgeId: 'v', sourceNodeId: 'v', url: 'v.mp4', mediaType: 'video' },
  ];
  const text = '@image1 next to @image2, moving like @video1.';
  const live = tags.syncTagsWithText(text, [], original);
  const remaining = [{ ...original[1], portIndex: 0, label: 'image1' }, original[2]];
  const fixed = tags.reconcileMediaPromptTags(text, live, remaining);
  assert.equal(fixed.prompt, 'image1 next to @image1, moving like @video1.');
  assert.deepEqual(fixed.tags.map(t => [t.label, t.edgeId]), [['image1', 'b'], ['video1', 'v']]);
  assert.equal(tags.reconcileMediaPromptTags(fixed.prompt, fixed.tags, remaining), null);
  const replaced = [{ ...remaining[0], edgeId: 'new', sourceNodeId: 'new' }, remaining[1]];
  assert.equal(tags.reconcileMediaPromptTags(fixed.prompt, fixed.tags, replaced).prompt, 'image1 next to image1, moving like @video1.');
});

for (const [model, expectedPrompt] of [
  ['seedance-2-5', 'Use @Image2 with @Video1 and @Image1.'],
  ['seedance-2', 'Use @Image2 with @Video1 and @Image1.'],
  ['google-omni-flash', 'Use <IMAGE_REF_1> with <VIDEO_REF_0> and <IMAGE_REF_0>.'],
  ['minimax-h3-max', 'Use Image 2 with Video 1 and Image 1.'],
  ['wan-3-prime', 'Use Image 2 with Video 1 and Image 1.'],
]) {
  test(`${model}: UI tags compile to API references while sending the actual files`, () => {
    const { input } = build(request(model, { prompt: 'Use @image2 with @video1 and @image1.' }));
    assert.equal(input.prompt, expectedPrompt);
    const spec = models.find(m => m.id === model);
    assert.deepEqual(input[spec.imageParam], ['https://example.com/a.png', 'https://example.com/b.png']);
    assert.deepEqual(input[spec.videoParam], ['https://example.com/reference.mp4']);
    assert.throws(() => build(request(model, { prompt: '@video2' })), /has no connected video/);
    assert.throws(() => build(request(model, { prompt: '@image0' })), /has no connected image/);
  });
}

test('Prompt nodes expose both modalities without conflating image1 and video1', () => {
  const nodes = [{ id: 'ref', type: 'referenceVideoNode', data: {} }];
  const edges = [
    { id: 'p', source: 'prompt', sourceHandle: 'prompt', target: 'ref', targetHandle: 'prompt' },
    { id: 'i', source: 'image', target: 'ref', targetHandle: 'reference_images' },
    { id: 'v', source: 'video', target: 'ref', targetHandle: 'reference_videos' },
  ];
  const inputs = tags.getDownstreamTaggableInputs('prompt', nodes, edges);
  assert.deepEqual(inputs.map(i => i.label), ['image1', 'video1']);
  const live = tags.syncTagsWithText('@image1 @video1', [], inputs);
  const fixed = tags.reconcilePositionalTags('prompt', '@image1 @video1', live, nodes, edges.filter(e => e.id !== 'v'));
  assert.equal(fixed.prompt, '@image1 video1');
  assert.deepEqual(fixed.tags.map(t => t.label), ['image1']);
});

const { estimateFalCost, formatFalCostEstimate } = load('src/lib/falPricing.ts');
const pricingModels = load('src/lib/api/models.ts', {
  '@/lib/promptTags': tags,
  './referenceVideo': config,
  '@/lib/layerize': { LAYERIZE_ENDPOINT: 'fal-ai/qwen-image-layered' },
});
const basePrices = {
  'seedance-2-5': 0.0214, 'seedance-2': 0.014,
  'google-omni-flash': 0.10, 'minimax-h3-max': 0.08, 'wan-3-prime': 0.28,
};
function estimate(modelId, changes = {}) {
  const model = models.find(model => model.id === modelId);
  return estimateFalCost(
    { endpointId: model.endpoint, unitPrice: basePrices[modelId], currency: 'USD', unit: 'unit' },
    pricingModels.getFalPricingRule(model.endpoint),
    { endpoint: model.endpoint, resolution: model.defaultResolution, aspectRatio: model.defaultAspectRatio,
      duration: 5, referenceImages: [], referenceVideos: [], ...changes },
  );
}

test('All reference models are registered for pricing and estimate every offered resolution/aspect ratio', () => {
  for (const model of models) {
    assert.ok(pricingModels.getFalPricingEndpointIds().includes(model.endpoint));
    for (const resolution of model.resolutions) {
      for (const aspectRatio of model.aspectRatios) {
        const cost = estimate(model.id, { resolution, aspectRatio });
        assert.ok(Number.isFinite(cost) && cost > 0, `${model.id}: ${resolution} ${aspectRatio}`);
      }
    }
    assert.equal(estimate(model.id, { duration: undefined }), null);
  }
});

test('Seedance bills combined input/output seconds with the reference video discount', () => {
  const clip = { width: 1280, height: 720, duration: 8 };
  assert.equal(formatFalCostEstimate(estimate('seedance-2-5', { duration: 10 })), '~$4.62');
  assert.equal(formatFalCostEstimate(estimate('seedance-2-5', { duration: 10, referenceVideos: [clip] })), '~$4.99');
  assert.equal(formatFalCostEstimate(estimate('seedance-2-5', { duration: 30, referenceVideos: [{ ...clip, duration: 10 }] })), '~$11.09');
  assert.equal(estimate('seedance-2', { referenceVideos: [clip, clip] }), estimate('seedance-2', { referenceVideos: [{ ...clip, duration: 16 }] }));
  // Portrait must keep the same pixel area as landscape, including the default Auto estimate.
  assert.equal(estimate('seedance-2', { aspectRatio: '9:16' }), estimate('seedance-2'));
  assert.ok(estimate('seedance-2', { resolution: '480p' }) < estimate('seedance-2'));
  assert.ok(estimate('seedance-2', { resolution: '4k' }) > estimate('seedance-2', { resolution: '1080p' }));
  assert.equal(estimate('seedance-2', { generateAudio: false }), estimate('seedance-2', { generateAudio: true }));
});

test('MiniMax pools image/video reference tokens and deducts the included allowance once', () => {
  const image = { width: 1024, height: 1024 };
  const video = { width: 1280, height: 720, duration: 5 };
  assert.equal(formatFalCostEstimate(estimate('minimax-h3-max', { referenceImages: [image, image], referenceVideos: [video] })), '~$1.00');
  assert.equal(estimate('minimax-h3-max', { referenceImages: Array(4).fill(image) }), 0.4);
  assert.equal(formatFalCostEstimate(estimate('minimax-h3-max', { referenceImages: Array(5).fill(image) })), '~$0.42');
  assert.equal(formatFalCostEstimate(estimate('minimax-h3-max', { resolution: '1080P' })), '~$0.80');
});

test('MiniMax matches published image-shape and mixed-reference examples regardless of upload size', () => {
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
  for (const side of [1024, 2048, 4096]) {
    close(estimate('minimax-h3-max', { referenceImages: Array(5).fill({ width: side, height: side }) }), 0.42048);
  }
  close(estimate('minimax-h3-max', { referenceImages: Array(3).fill({ width: 800, height: 600 }) }), 0.40064);
  close(estimate('minimax-h3-max', { referenceImages: Array(3).fill({ width: 1080, height: 1920 }) }), 0.42752);
  const referenceImages = Array(2).fill({ width: 2048, height: 2048 });
  const referenceVideos = [{ width: 1280, height: 720, duration: 5 }];
  for (const [resolution, expected] of [['480P', 0.45864], ['768P', 1.00416], ['1080P', 1.40416]]) {
    close(estimate('minimax-h3-max', { resolution, referenceImages, referenceVideos }), expected);
    close(estimate('minimax-h3-max', { resolution, referenceImages, referenceVideos: [{ ...referenceVideos[0], duration: 15 }] }), expected);
  }
  close(estimate('minimax-h3-max', { duration: 10, referenceImages: [{ width: 1024, height: 1024 }], referenceVideos }), 1.38368);
  close(estimate('minimax-h3-max', { duration: 15, referenceImages: Array(4).fill({ width: 1024, height: 1024 }),
    referenceVideos: [{ width: 1920, height: 1080, duration: 15 }] }), 3.25632);
});

test('Nano Banana 2.1 estimates generation/edit tokens, prompt size, resolutions, and repeated outputs', () => {
  for (const endpoint of ['google/nano-banana-2.1', 'google/nano-banana-2.1/edit']) {
    const rule = pricingModels.getFalPricingRule(endpoint);
    for (const [resolution, expected] of [['1K', 0.03970568], ['2K', 0.05947032], ['4K', 0.13358772]]) {
      const cost = estimateFalCost(undefined, rule, { endpoint, resolution, prompt: 'a'.repeat(400) });
      assert.ok(Math.abs(cost - expected) < 1e-9);
      const edited = estimateFalCost(undefined, rule, { endpoint, resolution, prompt: 'a'.repeat(400), referenceImageCount: 2, outputCount: 4 });
      assert.ok(Math.abs(edited - (expected + 0.00395136) * 4) < 1e-9);
    }
    const short = estimateFalCost(undefined, rule, { endpoint, resolution: '1K', prompt: 'a'.repeat(400) });
    const long = estimateFalCost(undefined, rule, { endpoint, resolution: '1K', prompt: 'a'.repeat(4400) });
    assert.ok(Math.abs(long - short - 0.001764) < 1e-9);
    assert.equal(estimateFalCost(undefined, rule, { endpoint, resolution: '8K' }), null);
  }
});

test('Generate button estimates survive unavailable/incomplete live pricing and prefer available live rates', () => {
  const pricing = load('src/lib/falPricing.ts');
  let state = { prices: {}, status: 'unavailable', load: async () => {} };
  const hook = load('src/lib/useFalCostEstimate.ts', {
    react: { useEffect() {} },
    '@/lib/falPricing': pricing,
    '@/lib/api/models': pricingModels,
    '@/lib/api/referenceVideo': config,
    '@/lib/stores/falPricingStore': { useFalPricingStore: selector => selector(state) },
  });
  for (const model of models) {
    const input = { endpoint: model.endpoint, resolution: model.defaultResolution,
      aspectRatio: model.defaultAspectRatio, duration: 5, referenceImages: [], referenceVideos: [] };
    const fallback = hook.useFalCostEstimateValue(input);
    assert.ok(fallback > 0, model.name);
    const live = config.getReferenceVideoEstimatePrice(model.endpoint);
    state = { ...state, status: 'ready', prices: { [model.endpoint]: { ...live, unitPrice: live.unitPrice * 2 } } };
    assert.equal(hook.useFalCostEstimateValue(input), fallback * 2);
    state = { ...state, prices: {} };
    assert.equal(hook.useFalCostEstimateValue([input, input]), fallback * 2);
  }
  const component = load('src/components/canvas/nodes/FalCostEstimate.tsx', {
    '@/lib/useFalCostEstimate': hook,
    './ImageGenerationGlass.module.css': { default: { costEstimate: 'cost' } },
  }).default;
  const { renderToStaticMarkup } = require('react-dom/server');
  const { createElement } = require('react');
  const imageInput = { endpoint: 'google/nano-banana-2.1', resolution: '4K', outputCount: 4 };
  assert.match(renderToStaticMarkup(createElement(component, { input: imageInput })), /~\$0\.53/);
  const videoInput = { endpoint: 'alibaba/wan-3.0-prime/reference-to-video', resolution: '720p', duration: 5 };
  assert.match(renderToStaticMarkup(createElement(component, { input: videoInput })), /~\$0\.70/);
  assert.match(renderToStaticMarkup(createElement(component, { input: null, unavailableText: 'Estimate unavailable' })), /Estimate unavailable/);
});

test('Pricing metadata resolves saved GCS references before loading image/video elements', async t => {
  const resolved = [], loaded = [];
  let state;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else delete globalThis.window;
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else delete globalThis.document;
  });
  class Image {
    naturalWidth = 2048;
    naturalHeight = 2048;
    set src(url) { loaded.push(url); queueMicrotask(() => this.onload()); }
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { Image } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({
    videoWidth: 1280, videoHeight: 720, duration: 5,
    set src(url) { loaded.push(url); },
    load() { queueMicrotask(() => this.onloadedmetadata()); },
  }) } });
  // Exercise the hook with stubbed React state/effects, outside a React tree.
  const { useMediaMetadata: readMetadata } = load('src/lib/useMediaMetadata.ts', {
    react: { useMemo: fn => fn(), useState: initial => [state ?? initial, value => { state = value; }], useEffect: fn => fn() },
    '@/lib/utils/mediaUtils': { resolveMediaUrl: async ref => { resolved.push(ref); return 'https://media.example/' + ref.slice(4); } },
  });
  for (const kind of ['image', 'video']) {
    state = undefined;
    const ref = `gcs:uploads/${kind}`;
    readMetadata([ref, ref], kind);
    await new Promise(resolve => setImmediate(resolve));
    const metadata = readMetadata([ref], kind).get(ref);
    assert.equal(metadata.width, kind === 'image' ? 2048 : 1280);
    if (kind === 'video') assert.equal(metadata.duration, 5);
  }
  assert.deepEqual(resolved, ['gcs:uploads/image', 'gcs:uploads/video']);
  assert.deepEqual(loaded, ['https://media.example/uploads/image', 'https://media.example/uploads/video']);
});

test('Reference metadata failures never display an incomplete total; per-second models need no metadata', () => {
  for (const referenceVideos of [[null], [{ width: 1, height: 1 }], [{ width: 1, height: 1, duration: NaN }]]) {
    for (const model of ['seedance-2', 'seedance-2-5', 'minimax-h3-max']) {
      assert.equal(estimate(model, { referenceVideos }), null);
    }
  }
  assert.equal(estimate('minimax-h3-max', { referenceImages: [null] }), null);
  assert.equal(formatFalCostEstimate(estimate('google-omni-flash', { duration: 10, resolution: '360p', referenceVideos: [null] })), '~$0.30');
  assert.equal(formatFalCostEstimate(estimate('google-omni-flash', { duration: 10, resolution: '1080p' })), '~$1.50');
  assert.equal(formatFalCostEstimate(estimate('wan-3-prime', { resolution: '720p', referenceVideos: [null] })), '~$0.70');
  assert.equal(formatFalCostEstimate(estimate('wan-3-prime', { resolution: '480p' })), '~$0.34');
  assert.equal(estimateFalCost(undefined, models[0].pricing, { endpoint: models[0].endpoint }), null);
  assert.equal(formatFalCostEstimate(null), null);
});
