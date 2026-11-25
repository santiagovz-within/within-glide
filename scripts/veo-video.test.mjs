import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(file, dependencies = {}, cache = new Map()) {
  if (cache.has(file)) return cache.get(file);
  const { outputText } = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const loaded = { exports: {} };
  cache.set(file, loaded.exports);
  new Function('require', 'module', 'exports', outputText)(name => {
    if (name in dependencies) return dependencies[name];
    if (name.startsWith('@/')) return load(`src/${name.slice(2)}.ts`, dependencies, cache);
    if (name.startsWith('.')) return load(path.join(path.dirname(file), `${name}.ts`), dependencies, cache);
    return require(name);
  }, loaded, loaded.exports);
  return loaded.exports;
}

const models = load('src/lib/api/models.ts');
const reference = load('src/lib/api/referenceVideo.ts');
const { getVideoGenerationSettings: settings } = load('src/lib/videoGenerationSettings.ts');
const { estimateFalCost } = load('src/lib/falPricing.ts');
const { videoGenerationMetadata } = load('src/lib/seedanceDraft.ts');
const endpoints = ['fal-ai/veo3.1', 'fal-ai/veo3.1/image-to-video', 'fal-ai/veo3.1/reference-to-video'];
const images = ['https://example.com/a.png', 'https://example.com/b.png', 'https://example.com/c.png'];
const base = { model: 'veo-3-1', prompt: 'A cinematic scene', sourceType: 'canvas', sourceId: 'flow', nodeId: 'node' };

function routeHarness() {
  const rows = [], submitted = [];
  let attempts = 0;
  const db = { auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) },
    from: () => ({ insert: row => {
      rows.push(row);
      return { select: () => ({ single: async () => ({ data: { id: 'generation' } }) }) };
    } }),
  };
  const { POST } = load('src/app/api/fal/generate/route.ts', {
    'next/server': { NextResponse: { json: (value, init) => Response.json(value, init) } },
    '@/lib/supabase/server': { createClient: async () => db },
    '@fal-ai/client': { fal: { config() {}, queue: { submit: async (endpoint, payload) => {
      submitted.push({ endpoint, ...payload }); return { request_id: 'request' };
    } } } },
    '@/lib/generationAttempt': { registerGenerationAttempt: async () => { attempts++; } },
    '@/lib/falStorage': { getFalStorageHeaders: async () => ({ 'storage-test': 'preserved' }) },
    '@/lib/falErrors': { describeFalError: String },
  });
  return { rows, submitted, attempts: () => attempts, post: body => POST({ json: async () => body }) };
}

test('Veo is directly below Seedance 2.0 in both menus and normalizes incompatible saved settings', () => {
  for (const menu of [models.VIDEO_MODELS, reference.REFERENCE_VIDEO_MODELS]) {
    assert.equal(menu[menu.findIndex(model => model.id === 'seedance-2') + 1].id, 'veo-3-1');
  }
  const video = settings({ model: 'veo-3-1', duration: 15, videoResolution: '480p', aspectRatio: '1:1', draftMode: true });
  assert.equal(video.duration, 8);
  assert.equal(video.resolution, '720p');
  assert.equal(video.aspectRatio, '16:9');
  assert.equal(video.draftMode, false);
  assert.equal(video.supportsEndFrame, false);
  assert.equal(video.supportsAudio, true);
  assert.deepEqual(video.durations, [4, 6, 8]);
  assert.equal(video.endpoint, endpoints[0]);
  assert.equal(settings({ model: 'veo-3-1', startFrameUrl: images[0] }).endpoint, endpoints[1]);
});

for (const hasImage of [false, true]) {
  test(`Veo ${hasImage ? 'image' : 'text'} mode queues exact Fal fields and recoverable metadata`, async () => {
    const route = routeHarness();
    for (const duration of [4, 6, 8]) for (const videoResolution of ['720p', '1080p', '4k']) {
      const promptSnapshot = { prompt: 'A cinematic scene', promptTags: [] };
      const body = { ...base, duration, videoResolution, aspectRatio: '9:16', generateAudio: false,
        negativePrompt: 'blur', generationRunId: 'run', promptSnapshot,
        ...(hasImage ? { startFrameUrl: images[0] } : {}) };
      const response = await route.post(body);
      assert.equal(response.status, 200);
      const result = await response.json();
      const endpoint = endpoints[hasImage ? 1 : 0];
      assert.deepEqual(result, { generationId: 'generation', requestId: 'request', endpoint, status: 'pending' });
      assert.deepEqual(route.submitted.at(-1), { endpoint, headers: { 'storage-test': 'preserved' }, input: {
        prompt: base.prompt, aspect_ratio: '9:16', duration: `${duration}s`, resolution: videoResolution,
        generate_audio: false, negative_prompt: 'blur', ...(hasImage ? { image_url: images[0] } : {}),
      } });
      const row = route.rows.at(-1);
      assert.equal(row.model, 'veo-3-1');
      assert.equal(row.media_type, 'video');
      assert.equal(row.fal_request_id, 'request');
      assert.deepEqual(row.parameters, { generationRunId: 'run', aspectRatio: '9:16', promptSnapshot,
        resolution: videoResolution, duration, endpoint, generateAudio: false });
      assert.equal(videoGenerationMetadata({ ...row, id: 'generation' }).duration, duration);
    }
    assert.equal((await route.post({ ...base, ...(hasImage ? { startFrameUrl: images[0] } : {}) })).status, 200);
    assert.deepEqual(route.submitted.at(-1).input, { prompt: base.prompt, aspect_ratio: hasImage ? 'auto' : '16:9',
      duration: '8s', resolution: '720p', generate_audio: true, ...(hasImage ? { image_url: images[0] } : {}) });
  });
}

test('Veo reference mode preserves image order, compiles tags, sends 8s, and saves numeric history duration', async () => {
  const route = routeHarness();
  for (const videoResolution of ['720p', '1080p', '4k']) for (const aspectRatio of ['16:9', '9:16']) {
    const body = { ...base, prompt: 'Combine @image3 with @image1', generationMode: 'reference-to-video',
      referenceImageUrls: images, referenceVideoUrls: [], referenceDuration: 8, generateAudio: false,
      videoResolution, aspectRatio };
    assert.equal((await route.post(body)).status, 200);
    assert.deepEqual(route.submitted.at(-1).input, { prompt: 'Combine Image 3 with Image 1', image_urls: images,
      aspect_ratio: aspectRatio, resolution: videoResolution, duration: '8s', generate_audio: false });
    assert.equal(route.submitted.at(-1).endpoint, endpoints[2]);
    const row = route.rows.at(-1);
    assert.deepEqual(row.reference_image_urls, images);
    assert.equal(row.parameters.endpoint, endpoints[2]);
    assert.equal(row.parameters.generationMode, 'reference-to-video');
    assert.equal(row.parameters.duration, 8);
    assert.equal(videoGenerationMetadata({ ...row, id: 'generation' }).duration, 8);
  }
  assert.equal(reference.buildReferenceVideoInput({ ...base, referenceImageUrls: [images[0]] }).input.generate_audio, true);
});

test('invalid Veo requests never register an attempt, submit a paid job, or write a generation', async () => {
  const route = routeHarness();
  const invalid = [
    { duration: 5 }, { duration: '8s' }, { duration: 6.5 }, { duration: 30 },
    { videoResolution: '480p' }, { aspectRatio: '1:1' }, { aspectRatio: 'auto' },
    { prompt: '' }, { prompt: ' ' }, { prompt: 12 }, { prompt: 'x'.repeat(20_001) },
    { startFrameUrl: ' ' }, { startFrameUrl: 12 }, { startFrameUrl: images[0], endFrameUrl: images[1] },
    { endFrameUrl: images[0] }, { generateAudio: 'false' }, { negativePrompt: false }, { draft: true },
  ];
  const ref = { generationMode: 'reference-to-video', referenceImageUrls: images };
  invalid.push(...[
    { referenceDuration: 4 }, { referenceDuration: 6 }, { referenceDuration: '8s' }, { referenceDuration: 'auto' },
    { referenceImageUrls: [] }, { referenceImageUrls: [...images, images[0]] }, { referenceImageUrls: [undefined] },
    { referenceVideoUrls: ['https://example.com/clip.mp4'] }, { aspectRatio: 'auto' }, { videoResolution: '480p' },
    { generateAudio: 'false' }, { prompt: 'Use @image4' }, { prompt: 'x'.repeat(20_001) },
  ].map(changes => ({ ...ref, ...changes })));
  for (const changes of invalid) {
    const response = await route.post({ ...base, ...changes });
    assert.equal(response.status, 400, JSON.stringify(changes).slice(0, 150));
    assert.ok((await response.json()).error);
  }
  assert.equal(route.attempts(), 0);
  assert.deepEqual(route.submitted, []);
  assert.deepEqual(route.rows, []);
});

test('all Veo endpoints estimate audio and resolution tiers without assuming a live base rate', () => {
  for (const endpoint of endpoints) {
    assert.ok(models.getFalPricingEndpointIds().includes(endpoint));
    for (const [resolution, silent, audio] of [['720p', 1.6, 3.2], ['1080p', 1.6, 3.2], ['4k', 3.2, 4.8]]) {
      const input = { endpoint, resolution, duration: 8 };
      const rule = models.getFalPricingRule(endpoint);
      assert.equal(estimateFalCost(undefined, rule, { ...input, generateAudio: false }), silent);
      assert.equal(estimateFalCost(undefined, rule, { ...input, generateAudio: true }), audio);
      assert.equal(estimateFalCost(undefined, rule, input), audio);
    }
  }
});

function elements(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return [tree, ...elements(tree.props?.children), ...elements(tree.props?.footer)];
}
function textContent(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (Array.isArray(tree)) return tree.map(textContent).join('');
  return tree?.props ? textContent(tree.props.children) + textContent(tree.props.footer) : '';
}
function renderNode(kind, { model = 'veo-3-1', withVideo = false, withEndFrame = false } = {}) {
  const data = { ...base, model, aspectRatio: '16:9', status: 'idle', startFrameUrl: images[0],
    ...(withEndFrame ? { endFrameUrl: images[1] } : {}) };
  const edges = [{ id: 'start', target: 'node', source: 'image', targetHandle: 'start_frame' },
    ...(withEndFrame ? [{ id: 'end', target: 'node', source: 'end', targetHandle: 'end_frame' }] : [])];
  const state = { currentFlow: { id: 'flow' }, nodes: [], edges };
  const useFlowStore = selector => selector(state);
  const dependencies = {
    react: { useEffect() {}, useLayoutEffect() {}, useRef: () => ({ current: null }),
      useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}] },
    'next/image': { default: 'Image' },
    '@/lib/stores/flowStore': { useFlowStore },
    '@/lib/stores/generationStore': { generationJobId: () => 'job', useGenerationStore: selector => selector({ jobs: {} }) },
    '@/lib/generationTracker': {}, '@/lib/utils/download': {},
    '@/lib/useGenerationHistoryPrompt': { useGenerationHistoryPrompt: () => ({}) },
    '@/lib/useFalCostEstimate': { useFalCostEstimateValue: () => 3.2 },
    '@/lib/useMediaMetadata': { useMediaMetadata: () => new Map() },
    '../referenceVideoInputs': {
      REFERENCE_IMAGE_HANDLE: 'reference_images', REFERENCE_VIDEO_HANDLE: 'reference_videos',
      getReferenceVideoTaggableInputs: () => [],
      getReferenceVideoInputs: () => ({ images: [{ edgeId: 'image', url: images[0] }],
        videos: withVideo ? [{ edgeId: 'clip', url: 'https://example.com/clip.mp4' }] : [] }),
    },
    './ImageGenerationGlass.module.css': {},
  };
  const components = {
    NodeWrapper: ['NodeWrapper'], TypedHandle: ['TypedHandle'], PromptEditor: ['PromptEditor'],
    ReferenceInputRow: ['ReferenceInputRow'], DisconnectInputButton: ['DisconnectInputButton'],
    ModelSelect: ['ModelSelect'], NodeSelect: ['NodeSelect'], AspectRatioGlyph: ['AspectRatioGlyph'],
    GenerationPreview: ['GenerationPreview'], GenerationFailure: ['GenerationFailureOverlay', 'RegenerateGate'],
    ExpensiveGenerationDialog: ['ExpensiveGenerationDialog'], SeedanceDraftControls: ['SeedanceDraftActions', 'SeedanceDraftToggle'],
  };
  for (const [module, names] of Object.entries(components)) dependencies[`./${module}`] = Object.fromEntries(names.map(name => [name, name]));
  dependencies['./TypedHandle'].PORT_COLORS = {};
  dependencies['./FalCostEstimate'] = { default: 'FalCostEstimate' };
  dependencies['../CanvasMedia'] = dependencies['@/components/canvas/CanvasMedia'] = { CanvasImage: 'CanvasImage', CanvasVideo: 'CanvasVideo' };
  const Component = load(`src/components/canvas/nodes/${kind}.tsx`, dependencies)[kind];
  const tree = Component({ id: 'node', data });
  return { tree, elements: elements(tree) };
}

test('Veo reference controls lock 8s, hide the video input, and keep old video connections removable', () => {
  const node = renderNode('ReferenceVideoNode');
  const duration = node.elements.find(el => el.props?.label === 'Seconds to generate');
  assert.equal(duration.props.value, '8s');
  assert.deepEqual(duration.props.options, ['8s']);
  assert.equal(duration.props.locked, true);
  assert.equal(node.elements.some(el => el.props?.id === 'reference_videos'), false);
  assert.match(textContent(node.tree), /Image References \(1\/3\)/);
  const old = renderNode('ReferenceVideoNode', { withVideo: true });
  assert.equal(old.elements.find(el => el.props?.id === 'reference_videos').props.disabled, true);
  assert.ok(old.elements.some(el => el.type === 'ReferenceInputRow' && el.props.edgeId === 'clip'));
  assert.equal(old.elements.find(el => el.type === 'button' && textContent(el).startsWith('Generate')).props.disabled, true);
  assert.match(textContent(old.tree), /Disconnect video references/);
  assert.ok(renderNode('ReferenceVideoNode', { model: 'seedance-2' }).elements.some(el => el.props?.id === 'reference_videos'));
});

test('Veo video controls omit end frames, but keep an existing end frame visible with generation blocked', () => {
  const node = renderNode('VideoGenNode');
  assert.equal(node.elements.some(el => el.props?.id === 'end_frame'), false);
  const old = renderNode('VideoGenNode', { withEndFrame: true });
  assert.equal(old.elements.find(el => el.props?.id === 'end_frame').props.disabled, true);
  assert.ok(old.elements.some(el => el.type === 'ReferenceInputRow' && el.props.edgeId === 'end'));
  assert.equal(old.elements.find(el => el.type === 'button' && textContent(el).startsWith('Generate')).props.disabled, true);
  assert.match(textContent(old.tree), /Disconnect the end frame/);
});
