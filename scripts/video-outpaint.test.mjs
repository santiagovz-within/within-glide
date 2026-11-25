import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url).pathname;
function load(file, dependencies = {}, cache = new Map()) {
  const path = resolve(root, file);
  if (cache.has(path)) return cache.get(path).exports;
  const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const loaded = { exports: {} }; cache.set(path, loaded);
  new Function('require', 'module', 'exports', outputText)(name => {
    if (name in dependencies) return dependencies[name];
    if (name.startsWith('@/') || name.startsWith('.')) {
      const base = name.startsWith('@/') ? resolve(root, 'src', name.slice(2)) : resolve(dirname(path), name);
      const target = [base, `${base}.ts`, `${base}.tsx`].find(existsSync);
      return load(target, dependencies, cache);
    }
    return require(name);
  }, loaded, loaded.exports);
  return loaded.exports;
}
const config = load('src/lib/api/videoOutpaint.ts');
const { VIDEO_OUTPAINT_MODELS: models, buildVideoOutpaintInput: build, getVideoOutpaintSettings: settings, videoOutpaintPlacement: placement } = config;
const pricing = load('src/lib/falPricing.ts');
const registry = load('src/lib/api/models.ts');
const body = (model, changes = {}) => ({ model, videoUrl: 'https://example.com/source.mp4',
  prompt: 'Continue the scene', duration: 5, sourceWidth: 1920, sourceHeight: 1080, ...changes });

test('saved nodes default to LTX 2.5 and switching models normalizes unsupported settings', () => {
  assert.deepEqual(models.map(model => model.id), ['ltx-2.5', 'luma-ray-3.2', 'minimax-h3-max']);
  assert.equal(settings({}).model.id, 'ltx-2.5');
  assert.equal(settings({ outpaintModel: 'ltx-2.3' }).model.id, 'ltx-2.5');
  assert.deepEqual(settings({ outpaintModel: 'minimax-h3-max', outpaintResolution: '720p', outpaintAspectRatio: '4:5' }),
    { model: models[2], aspectRatio: '16:9', resolution: '768p' });
  assert.equal(settings({ outpaintModel: 'ltx-2.5', outpaintResolution: '1080p', outpaintAspectRatio: '4:5' }).aspectRatio, '4:5');
  const legacy = build(body(undefined, { fps: 30, numFrames: 150 }));
  assert.equal(legacy.model.endpoint, 'fal-ai/ltx-2.3-quality/outpaint');
  assert.equal(legacy.input.num_frames, 150);
  assert.equal(legacy.input.frames_per_second, 30);
  assert.equal(legacy.input.generate_audio, false);
});

test('new models submit only their supported fields, preserving source duration', () => {
  const ltx = build(body('ltx-2.5', { prompt: '', negativePrompt: 'ignore me', fps: 60 })).input;
  assert.deepEqual(Object.keys(ltx).sort(), ['aspect_ratio', 'placement', 'resolution', 'video_url']);
  assert.deepEqual(ltx.placement, { x: 0, y: 0, width: 1, height: 1 });
  const luma = build(body('luma-ray-3.2')).input;
  assert.deepEqual(Object.keys(luma).sort(), ['aspect_ratio', 'prompt', 'resolution', 'source_position', 'video_url']);
  assert.equal(luma.duration, undefined, 'Do not override source length with a fixed 5s/10s duration.');
  const mini = build(body('minimax-h3-max', { prompt: '', anchor: 'left', sourceScale: 0.5 })).input;
  assert.deepEqual(mini, { video_url: 'https://example.com/source.mp4', aspect_ratio: '16:9', resolution: '768p' });
});

test('position and scale expand the intended sides without stretching the source', () => {
  const left = placement(1080, 1080, '16:9', 'left');
  assert.deepEqual(left, { x: 0, y: 0, width: 9 / 16, height: 1 });
  const top = placement(1920, 1080, '9:16', 'top');
  assert.equal(top.y, 0); assert.equal(top.width, 1);
  assert.ok(top.height < 1);
  assert.deepEqual(placement(1920, 1080, '16:9', 'center', 0.5), { x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
  const luma = build(body('luma-ray-3.2', { anchor: 'bottom_right', sourceScale: 0.5 })).input;
  assert.deepEqual(luma.source_position, { x_norm: 0.5, y_norm: 0.5, w_norm: 0.5, h_norm: 0.5 });
});

test('duration, resolution, prompt, placement and enlargement validation prevents invalid submissions', () => {
  for (const [id, patch] of [
    ['unknown', {}], ['luma-ray-3.2', { duration: 10.1 }], ['luma-ray-3.2', { prompt: '' }],
    ['minimax-h3-max', { duration: 301 }], ['minimax-h3-max', { duration: 0.1 }],
    ['ltx-2.5', { duration: 61 }], ['ltx-2.5', { aspectRatio: '21:9' }],
    ['ltx-2.5', { resolution: '4k' }], ['ltx-2.5', { anchor: 'invalid' }],
    ['ltx-2.5', { sourceScale: 0 }], ['ltx-2.5', { sourceWidth: NaN }],
    ['ltx-2.5', { resolution: '1080p', sourceWidth: 320, sourceHeight: 180 }],
  ]) assert.throws(() => build(body(id, patch)), undefined, `${id}: ${JSON.stringify(patch)}`);
  assert.doesNotThrow(() => build(body('luma-ray-3.2', { duration: 10 })));
  assert.doesNotThrow(() => build(body('minimax-h3-max', { duration: 300 })));
});

test('all model options are registered for billing; estimates match published rates and rounding', () => {
  for (const model of models) assert.ok(registry.getFalPricingEndpointIds().includes(model.endpoint));
  const estimate = (id, duration, resolution) => {
    const endpoint = models.find(model => model.id === id).endpoint;
    return pricing.estimateFalCost(undefined, registry.getFalPricingRule(endpoint), { endpoint, duration, resolution });
  };
  assert.equal(estimate('ltx-2.5', 5, '1080p'), 1);
  assert.equal(estimate('ltx-2.5', 5.5, '720p'), 0.55);
  assert.ok(Math.abs(estimate('luma-ray-3.2', 5, '1080p') - 1.8) < 1e-10);
  assert.equal(estimate('luma-ray-3.2', 5.01, '720p'), 0.72);
  assert.equal(estimate('minimax-h3-max', 5, '1080p'), 0.8);
  assert.equal(estimate('minimax-h3-max', 60, '1080p'), null, 'Do not omit unknown overlap charges from a total estimate.');
});

function database(rows = [], signedIn = true) {
  const filtersRead = [];
  return { rows, filtersRead, auth: { getUser: async () => ({ data: { user: signedIn ? { id: 'owner' } : null } }) },
    from() {
      const filters = []; let values, inserted;
      const q = {
        select() { return q; }, eq(k, v) { filters.push([k, v]); filtersRead.push([k, v]); return q; },
        maybeSingle() { return q; }, update(v) { values = v; return q; }, insert(v) { inserted = v; return q; },
        then(resolve) {
          if (inserted) rows.push({ id: 'generation', ...structuredClone(inserted) });
          const row = rows.find(row => filters.every(([k, v]) => row[k] === v));
          if (row && values) Object.assign(row, values);
          return Promise.resolve({ data: row ?? null, error: null }).then(resolve);
        },
      }; return q;
    },
  };
}
const next = { NextResponse: { json: (data, options) => Response.json(data, options) } };

test('submission routes all three models and saves the exact endpoint and settings', async () => {
  for (const model of models) {
    const db = database(); const requests = [];
    const { POST } = load('src/app/api/fal/video-outpaint/route.ts', {
      'next/server': next, '@/lib/supabase/server': { createClient: async () => db },
      '@/lib/falErrors': { describeFalError: error => error.message },
      '@/lib/falStorage': { getFalStorageHeaders: async () => ({ test: 'storage' }) },
      '@fal-ai/client': { fal: { config() {}, queue: { submit: async (...args) => { requests.push(args); return { request_id: 'request' }; } } } },
    });
    const response = await POST({ json: async () => body(model.id) });
    assert.equal(response.status, 200);
    assert.equal(requests[0][0], model.endpoint);
    assert.deepEqual(requests[0][1].headers, { test: 'storage' });
    assert.equal(db.rows[0].parameters.endpoint, model.endpoint);
    assert.equal(db.rows[0].model, model.endpoint);
    assert.deepEqual(db.rows[0].parameters.input, requests[0][1].input);
    const before = requests.length;
    assert.equal((await POST({ json: async () => body(model.id, { resolution: '8k' }) })).status, 400);
    assert.equal(requests.length, before);
  }
});

test('status and actual billing use the saved endpoint, including legacy jobs, scoped to the owner', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('video data');
  try {
    for (const model of [...models, config.getVideoOutpaintModel('ltx-2.3')]) {
      const row = { id: 'generation', user_id: 'owner', fal_request_id: 'request', model: model.endpoint,
        parameters: model.id === 'ltx-2.3' ? {} : { endpoint: model.endpoint } };
      const db = database([row]); const polled = [], billed = [];
      const { GET } = load('src/app/api/fal/video-outpaint/status/[requestId]/route.ts', {
        'next/server': next, '@/lib/supabase/server': { createClient: async () => db },
        '@fal-ai/client': { fal: { config() {}, queue: { status: async endpoint => { polled.push(endpoint); return { status: 'COMPLETED', response_url: 'result' }; } } } },
        '@/lib/gcs': { getSignedReadUrl: async () => 'https://example.com/result.mp4' },
        '@/lib/mediaDerivatives': { uploadMediaToGCS: async () => 'gcs:result.mp4' },
        '@/lib/falErrors': { describeFalError: error => error.message, isTerminalFalError: () => false },
        '@/lib/generationFailures': { failGeneration() { throw new Error('unexpected failure'); } },
        '@/lib/falResult': {
          fetchFalQueueResult: async () => ({ data: { video: { url: 'https://example.com/generated.mp4' } }, billableUnits: 7 }),
          getFalBillingColumns: async (endpoint, units) => { billed.push([endpoint, units]); return { fal_cost_usd: 1.2 }; },
          mergeFalBillingParameters: (parameters, billing) => ({ ...parameters, billing }),
          persistFalBillingBestEffort: async (billing, save) => save(billing),
        },
      });
      const response = await GET({}, { params: Promise.resolve({ requestId: 'request' }) });
      assert.equal((await response.json()).status, 'completed');
      assert.deepEqual(polled, [model.endpoint]);
      assert.deepEqual(billed, [[model.endpoint, 7]]);
      assert.equal(row.status, 'completed'); assert.equal(row.fal_cost_usd, 1.2);
      assert.ok(db.filtersRead.some(([key, value]) => key === 'user_id' && value === 'owner'));
    }
  } finally { globalThis.fetch = originalFetch; }
  assert.throws(() => config.getVideoOutpaintEndpoint({ endpoint: 'untrusted/model' }));
  assert.equal(config.getVideoOutpaintEndpoint(null), 'fal-ai/ltx-2.3-quality/outpaint');
});

function elements(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return [tree, ...elements(tree.props?.children), ...elements(tree.props?.footer)];
}

function modifyNodeHarness() {
  const state = [], refs = [];
  let stateIndex = 0, refIndex = 0;
  const store = { nodes: [{ id: 'source', type: 'videoInputNode', data: { videoUrl: 'https://example.com/source.mp4' } }],
    edges: [{ source: 'source', sourceHandle: 'video', target: 'modify', targetHandle: 'image' }],
    currentFlow: { id: 'flow' }, consumeGcsOnlyEligibility() {} };
  const flowHook = select => select(store); flowHook.getState = () => store;
  const dependencies = {
    react: { ...require('react'), useEffect() {}, useLayoutEffect() {}, useContext: () => false,
      useState(initial) { const index = stateIndex++; if (!(index in state)) state[index] = initial;
        return [state[index], value => { state[index] = value; }]; },
      useRef(initial) { const index = refIndex++; return refs[index] ??= { current: initial }; },
    },
    '@xyflow/react': { Position: { Left: 'left', Right: 'right' } },
    '@/lib/stores/flowStore': { useFlowStore: flowHook },
    '@/lib/utils/download': { downloadFromUrl() {} }, '@/lib/utils/sound': { playSuccessSound() {} },
    '@/components/canvas/mediaFocus': { CanvasNodeFocusContext: {} },
    '@/components/canvas/CanvasMedia': { CanvasVideo: 'video', CanvasImage: 'img' },
    './ImageGenerationGlass.module.css': { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) },
    './FalCostEstimate': { __esModule: true, default: 'CostEstimate' },
    './TypedHandle': { TypedHandle: 'TypedHandle', PORT_COLORS: { video: '#fff', image: '#fff' } },
  };
  for (const name of ['GenerationPreview', 'SendToFigmaButton', 'NodeWrapper', 'ModelSelect', 'NodeSelect', 'SourceThumbnails', 'LayerizePanel']) {
    dependencies[`./${name}`] = { [name]: name };
  }
  const { ModifyNode } = load('src/components/canvas/nodes/ModifyNode.tsx', dependencies);
  return { store, render(data) { stateIndex = 0; refIndex = 0;
    return elements(ModifyNode({ data: { model: 'seedream-5', status: 'idle', ...data }, id: 'modify' })); } };
}

test('Modify video UI exposes every model, persists switching, and submits the selected settings', async () => {
  const savedDocument = globalThis.document, savedFetch = globalThis.fetch;
  const changes = [], submitted = [];
  globalThis.document = { dispatchEvent: event => changes.push(event.detail.data) };
  globalThis.fetch = async (_url, options) => { submitted.push(JSON.parse(options.body)); return Response.json({ error: 'test completed without a paid job' }); };
  try {
    for (const model of models) {
      const harness = modifyNodeHarness();
      let nodes = harness.render({ outpaintModel: model.id });
      const select = nodes.find(node => node.type === 'NodeSelect' && node.props.options.includes('LTX 2.5 Reframe'));
      assert.deepEqual(select.props.options, models.map(model => model.name));
      select.props.onChange('MiniMax H3 Max Reframe');
      assert.equal(changes.at(-1).outpaintModel, 'minimax-h3-max');
      assert.equal(changes.at(-1).outpaintResolution, '768p');
      const preview = nodes.find(node => node.props?.onMetadata);
      preview.props.onMetadata({ url: 'https://example.com/source.mp4', width: 1920, height: 1080, duration: 5 });
      nodes = harness.render({ outpaintModel: model.id });
      assert.equal(nodes.filter(node => node.type === 'textarea').length, model.id === 'ltx-2.5' ? 0 : 1);
      const generate = nodes.find(node => node.type === 'button' && elements(node).some(child => child.type === 'CostEstimate'));
      assert.equal(generate.props.disabled, false);
      await generate.props.onClick();
      assert.equal(submitted.at(-1).model, model.id);
      assert.equal(submitted.at(-1).resolution, model.defaultResolution);
      assert.equal(submitted.at(-1).duration, 5);
      // Reconnected source must not reuse the previous video's measured duration.
      harness.store.nodes[0].data.videoUrl = 'https://example.com/other.mp4';
      nodes = harness.render({ outpaintModel: model.id });
      assert.equal(nodes.find(node => node.type === 'button' && elements(node).some(child => child.type === 'CostEstimate')).props.disabled, true);
    }
    const image = modifyNodeHarness();
    image.store.nodes[0] = { id: 'source', type: 'imageInputNode', data: { imageUrl: 'https://example.com/image.png' } };
    image.store.edges[0].sourceHandle = 'image';
    assert.equal(image.render({}).some(node => node.type === 'NodeSelect' && node.props.options.includes('LTX 2.5 Reframe')), false);
  } finally { globalThis.document = savedDocument; globalThis.fetch = savedFetch; }
});
