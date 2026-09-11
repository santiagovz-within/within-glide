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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
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
