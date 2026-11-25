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
const videoTools = load('src/lib/videoGenerationSettings.ts');
const chat = load('src/lib/chatGeneration.ts');
const defaults = { model: 'nano-banana-2-1', aspectRatio: '1:1', resolution: '1K', quality: 'medium',
  numGenerations: 1, duration: 5, videoResolution: '720p', generateAudio: true, draftMode: false };

function routeHarness() {
  const rows = [], submitted = [];
  const db = { auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) },
    from: () => ({ insert: row => { rows.push(row); return { select: () => ({ single: async () => ({ data: { id: 'generated' } }) }) }; } }),
  };
  const { POST } = load('src/app/api/fal/generate/route.ts', {
    'next/server': { NextResponse: { json: (value, init) => Response.json(value, init) } },
    '@/lib/supabase/server': { createClient: async () => db },
    '@fal-ai/client': { fal: { config() {}, queue: { submit: async (endpoint, payload) => {
      submitted.push({ endpoint, ...payload }); return { request_id: 'request' };
    } } } },
    '@/lib/generationAttempt': { registerGenerationAttempt: async () => {} },
    '@/lib/falStorage': { getFalStorageHeaders: async () => ({}) },
    '@/lib/falErrors': { describeFalError: String },
  });
  return { rows, submitted, post: body => POST({ json: async () => body }) };
}

test('chat defaults to Nano Banana 2.1 on first load and after switching back from video', () => {
  const { useChatStore } = load('src/lib/stores/chatStore.ts');
  assert.equal(useChatStore.getState().settings.model, 'nano-banana-2-1');
  useChatStore.getState().setMode('video');
  useChatStore.getState().updateSettings({ model: 'seedance-2-5', draftMode: true, videoResolution: '4k', duration: 30 });
  assert.equal(useChatStore.getState().settings.draftMode, true);
  useChatStore.getState().updateSettings({ model: 'minimax-h3-max' });
  assert.equal(useChatStore.getState().settings.videoResolution, '768P');
  assert.equal(useChatStore.getState().settings.duration, 5);
  assert.equal(useChatStore.getState().settings.draftMode, false);
  useChatStore.getState().setMode('image');
  assert.equal(useChatStore.getState().settings.model, 'nano-banana-2-1');
  assert.equal(useChatStore.getState().settings.resolution, '1K');
});

for (const model of models.VIDEO_MODELS) {
  test(`${model.name}: chat exposes and submits every canvas duration and resolution in text and frame modes`, async () => {
    const route = routeHarness();
    const options = videoTools.getVideoGenerationSettings({ model: model.id });
    for (const hasFrame of [false, true]) for (const duration of options.durations) for (const videoResolution of options.resolutions) {
      const references = hasFrame ? ['start.png', 'end.png'] : [];
      const settings = chat.normalizeChatSettings('video', { ...defaults, model: model.id, duration, videoResolution, generateAudio: false });
      const body = chat.buildChatGenerationRequest('video', settings, 'Original scene', references, 'session');
      const response = await route.post(body);
      assert.equal(response.status, 200, `${model.id} ${duration}s ${videoResolution}: ${await response.clone().text()}`);
      const queued = route.submitted.at(-1);
      assert.equal(queued.endpoint, videoTools.getVideoGenerationSettings({ ...settings, startFrameUrl: references[0] }).endpoint);
      assert.equal(route.rows.at(-1).source_type, 'chat');
      assert.equal(route.rows.at(-1).parameters.duration, duration);
      assert.equal(route.rows.at(-1).parameters.resolution, videoResolution);
      if (options.supportsAudio) assert.equal(queued.input.generate_audio ?? queued.input.audio, false);
      if (!options.supportsEndFrame) assert.equal(body.endFrameUrl, undefined);
    }
  });
}

test('Seedance 2.5 draft locks submission at 480p and keeps the full-quality resolution when switched off', async () => {
  const full = { ...defaults, model: 'seedance-2-5', videoResolution: '4k', duration: 30 };
  const draft = chat.normalizeChatSettings('video', { ...full, draftMode: true });
  assert.equal(draft.videoResolution, '4k');
  const body = chat.buildChatGenerationRequest('video', draft, 'Draft scene', [], 'session');
  assert.equal(body.videoResolution, '480p');
  assert.equal(body.draft, true);
  const route = routeHarness();
  assert.equal((await route.post(body)).status, 200);
  assert.equal(route.submitted[0].input.draft, true);
  assert.equal(route.rows[0].parameters.draft, true);
  assert.equal(route.rows[0].parameters.input.resolution, '480p');
  const final = chat.buildChatGenerationRequest('video', { ...draft, draftMode: false }, 'Full scene', [], 'session');
  assert.equal(final.videoResolution, '4k');
  assert.equal(final.draft, false);
});

function elements(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return [tree, ...elements(tree.props?.children)];
}
function textContent(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (Array.isArray(tree)) return tree.map(textContent).join('');
  return tree?.props ? textContent(tree.props.children) : '';
}
function composer(model, { draftMode = false, cost = 1, references = [], mode = 'video' } = {}) {
  let submitted = 0;
  const states = [];
  const settings = chat.normalizeChatSettings(mode, { ...defaults, model, draftMode });
  const state = { mode, settings, prompt: 'A scene', referenceImages: references, isGenerating: false };
  const { ChatInput } = load('src/components/chat/ChatInput.tsx', {
    react: { useLayoutEffect() {}, useRef: () => ({ current: null }),
      useState: initial => [typeof initial === 'function' ? initial() : initial, value => states.push(value)] },
    '@/lib/stores/chatStore': { useChatStore: () => state },
    '@/lib/api/models': models,
    '@/lib/videoGenerationSettings': videoTools,
    '@/lib/utils/imageProcessing': {},
    '@/lib/useFalCostEstimate': { useFalCostEstimateValue: () => cost },
    '@/lib/utils/cn': { cn: (...values) => values.filter(Boolean).join(' ') },
    '@/components/canvas/nodes/ModelSelect': { ModelSelect: 'ModelSelect' },
    '@/components/canvas/nodes/NodeSelect': { NodeSelect: 'NodeSelect' },
    '@/components/canvas/nodes/AspectRatioGlyph': { AspectRatioGlyph: 'AspectRatioGlyph' },
    '@/components/canvas/nodes/SeedanceDraftControls': { SeedanceDraftToggle: 'DraftToggle' },
    '@/components/canvas/nodes/ExpensiveGenerationDialog': { ExpensiveGenerationDialog: 'ConfirmDialog' },
    '@/components/canvas/nodes/ImageGenerationGlass.module.css': {}, './ImageVideo.module.css': {},
  });
  const tree = ChatInput({ onSubmit: () => { submitted++; } });
  return { tree, elements: elements(tree), states, submissions: () => submitted };
}

test('composer lists the exact canvas video menu and offers draft, audio, and locked 480p controls', () => {
  const c = composer('seedance-2-5', { draftMode: true });
  assert.deepEqual(c.elements.find(el => el.type === 'ModelSelect').props.options.map(model => model.id), models.VIDEO_MODELS.map(model => model.id));
  assert.equal(c.elements.find(el => el.type === 'DraftToggle').props.enabled, true);
  assert.ok(c.elements.some(el => el.props?.['aria-label'] === 'Generate audio'));
  const resolution = c.elements.find(el => el.props?.label === 'Video resolution');
  assert.equal(resolution.props.locked, true);
  assert.equal(resolution.props.value, '480p');
  assert.deepEqual(resolution.props.options, ['480p']);
  assert.match(textContent(c.tree), /Generate draft/);
});

test('composer hides unsupported FLUX end frames, keeps image mode simple, and follows start-frame aspect ratios', () => {
  const flux = composer('flux-3');
  assert.doesNotMatch(textContent(flux.tree), /End frame/);
  const image = composer('nano-banana-2-1', { mode: 'image' });
  assert.equal(image.elements.some(el => el.type === 'DraftToggle'), false);
  assert.equal(image.elements.some(el => el.props?.label === 'Video resolution'), false);
  const wan = composer('wan-3-prime', { references: ['start.png'] });
  const aspect = wan.elements.find(el => el.props?.label === 'Aspect ratio');
  assert.equal(aspect.props.locked, true);
  assert.equal(aspect.props.value, 'From start frame');
});

test('both Generate and the keyboard shortcut confirm expensive Seedance requests', () => {
  const c = composer('seedance-2-5', { cost: 12 });
  c.elements.find(el => el.type === 'button' && textContent(el).startsWith('Generate')).props.onClick();
  c.elements.find(el => el.type === 'textarea').props.onKeyDown({ key: 'Enter', metaKey: true, preventDefault() {} });
  assert.equal(c.submissions(), 0);
  assert.deepEqual(c.states, [true, true]);
});

function draftActions(generation, generations = {}) {
  const completed = [], viewed = [], estimates = [];
  const { ChatDraftActions } = load('src/components/chat/ChatDraftActions.tsx', {
    react: { useEffect() {}, useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}] },
    '@/lib/useFalCostEstimate': { useFalCostEstimateValue: input => { estimates.push(input); return 2; } },
    '@/lib/useMediaMetadata': { useMediaMetadata: () => new Map() },
    '@/components/canvas/nodes/ExpensiveGenerationDialog': { ExpensiveGenerationDialog: 'ConfirmDialog' },
  });
  const tree = ChatDraftActions({ generation, generations, submitting: false,
    onComplete: generation => completed.push(generation), onView: generation => viewed.push(generation) });
  return { tree, completed, viewed, estimates, button: elements(tree).find(el => el.type === 'button') };
}

test('saved draft actions complete the original draft, display progress, and open the final without regenerating', () => {
  const draft = { id: 'draft', model: 'seedance-2-5', status: 'completed', prompt: 'Original scene',
    parameters: { endpoint: 'bytedance/seedance-2.5/text-to-video', draft: true, draftId: 'provider-draft',
      draftExpiresAt: new Date(Date.now() + 60_000).toISOString(), aspectRatio: '16:9', duration: 30 } };
  const action = draftActions(draft);
  assert.equal(action.button.props.disabled, false);
  action.button.props.onClick();
  assert.deepEqual(action.completed, [draft]);
  assert.equal(action.estimates[0].resolution, '1080p');
  assert.equal(action.estimates[0].duration, 30);
  const final = { id: 'final', status: 'processing', parameters: { sourceDraftGenerationId: draft.id } };
  const processing = draftActions(draft, { final });
  assert.equal(processing.button.props.disabled, true);
  assert.match(textContent(processing.tree), /Rendering 1080p/);
  final.status = 'completed';
  const done = draftActions(draft, { final });
  done.button.props.onClick();
  assert.deepEqual(done.viewed, [final]);
  assert.deepEqual(done.completed, []);
  const expired = draftActions({ ...draft, parameters: { ...draft.parameters, draftExpiresAt: '2000-01-01' } });
  assert.equal(expired.button.props.disabled, true);
});

for (const terminal of ['completed', 'failed']) {
  test(`queued chat videos resume polling with their saved endpoint, retry transport errors and settle as ${terminal}`, async () => {
    const savedFetch = globalThis.fetch, savedTimeout = globalThis.setTimeout, savedClear = globalThis.clearTimeout;
    const timers = new Map(); let nextTimer = 0, cleanup, requests = 0;
    const generation = { id: 'generation', fal_request_id: 'request', status: 'processing', media_type: 'video',
      parameters: { endpoint: 'bytedance/seedance-2.5/draft/complete' } };
    const updates = [], gallery = [];
    const store = { generations: { generation }, addGeneration: item => updates.push(item) };
    const useChatStore = selector => selector(store);
    useChatStore.getState = () => store;
    globalThis.setTimeout = callback => { const id = ++nextTimer; timers.set(id, () => { timers.delete(id); callback(); }); return id; };
    globalThis.clearTimeout = id => timers.delete(id);
    globalThis.fetch = async (url, { signal }) => {
      requests++;
      assert.ok(url.includes('mediaType=video'));
      assert.ok(url.includes('endpoint=bytedance%2Fseedance-2.5%2Fdraft%2Fcomplete'));
      assert.equal(signal.aborted, false);
      if (requests === 1) throw new Error('Temporary network error');
      return Response.json({ status: terminal });
    };
    const query = { select() { return query; }, eq() { return query; }, abortSignal() { return query; },
      single: async () => ({ data: { ...generation, status: terminal } }) };
    try {
      const { useChatGenerationPolling } = load('src/lib/useChatGenerationPolling.ts', {
        react: { useEffect: effect => { cleanup = effect(); } },
        '@/lib/stores/chatStore': { useChatStore },
        '@/lib/stores/galleryStore': { useGalleryStore: { getState: () => ({ addGeneration: item => gallery.push(item) }) } },
        '@/lib/supabase/client': { createClient: () => ({ from: () => query }) },
      });
      useChatGenerationPolling();
      for (let step = 0; step < 2; step++) {
        assert.equal(timers.size, 1);
        [...timers.values()][0]();
        await new Promise(resolve => setImmediate(resolve));
      }
      assert.equal(updates.length, 1);
      assert.equal(updates[0].status, terminal);
      assert.deepEqual(gallery, updates);
      cleanup();
      assert.equal(timers.size, 0);
    } finally {
      globalThis.fetch = savedFetch; globalThis.setTimeout = savedTimeout; globalThis.clearTimeout = savedClear;
    }
  });
}
