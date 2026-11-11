import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(path, dependencies = {}) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const loadedModule = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(name => name in dependencies ? dependencies[name]
    : name === '@/lib/flowClients' ? load('src/lib/flowClients.ts')
    : name === '@/lib/seedanceDraft' ? draftTools : require(name), loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
const draftTools = load('src/lib/seedanceDraft.ts');
const { SEEDANCE_DRAFT_COMPLETE_ENDPOINT: endpoint, videoGenerationMetadata, saveVideoResultParameters } = draftTools;
const referenceConfig = load('src/lib/api/referenceVideo.ts');
const next = { NextResponse: { json: (value, init) => Response.json(value, init) } };
const { ApiError } = require('@fal-ai/client');
const started = new Date(Date.now() - 60_000).toISOString();
const input = { prompt: 'Original scene', duration: '10', resolution: '480p', draft: true, image_urls: ['image.png'], video_urls: ['motion.mp4'] };
function draftRow(overrides = {}) {
  return { id: 'draft-gen', user_id: 'user', source_id: 'flow', node_id: 'node', source_type: 'canvas',
    model: 'seedance-2-5', status: 'completed', created_at: started, prompt: 'Original scene', media_type: 'video',
    reference_image_urls: ['image.png'], media_url: 'draft.mp4', fal_request_id: 'draft-request',
    parameters: saveVideoResultParameters({ endpoint: 'bytedance/seedance-2.5/reference-to-video',
      draft: true, resolution: '480p', duration: '10', aspectRatio: '16:9', referenceVideoUrls: ['motion.mp4'], input },
    { draft_id: 'provider-draft', seed: 17 }, started), ...overrides };
}
const completionBody = { draftGenerationId: 'draft-gen', sourceType: 'canvas', sourceId: 'flow', nodeId: 'node',
  generationRunId: 'new-run', previousIdentity: 'old-run' };

// Model real JSON snapshots and conditional updates, including racing HTTP requests.
function database(rows = [], { authenticated = true, rejectInsert = false } = {}) {
  return { rows, auth: { getUser: async () => ({ data: { user: authenticated ? { id: 'user' } : null } }) },
    from(table) {
      assert.equal(table, 'generations');
      const filters = []; let update, insert, single = false;
      const q = {
        select() { return q; },
        eq(key, value) { filters.push(row => key === 'parameters' ? JSON.stringify(row[key]) === value : row[key] === value); return q; },
        maybeSingle() { single = true; return q; }, single() { single = true; return q; },
        update(values) { update = values; return q; }, insert(values) { insert = values; return q; },
        then(resolve, reject) { return Promise.resolve().then(() => {
          if (insert && rejectInsert) return { data: null, error: { message: 'Database unavailable' } };
          let matches;
          if (insert) {
            const row = { id: `gen-${rows.length}`, created_at: started, ...structuredClone(insert) };
            rows.push(row); matches = [row];
          } else {
            matches = rows.filter(row => filters.every(filter => filter(row)));
            if (update) matches.forEach(row => Object.assign(row, structuredClone(update)));
          }
          return { data: structuredClone(single ? matches[0] ?? null : matches), error: null };
        }).then(resolve, reject); },
      };
      return q;
    },
  };
}
function completionRoute(db, submit = async () => ({ request_id: 'hd-request' }), register = async () => {}) {
  return load('src/app/api/fal/draft/complete/route.ts', {
    'next/server': next, '@/lib/supabase/server': { createClient: async () => db },
    '@fal-ai/client': { ApiError, fal: { config() {}, queue: { submit } } },
    '@/lib/generationAttempt': { registerGenerationAttempt: register },
    '@/lib/falStorage': { getFalStorageHeaders: async () => ({ 'storage-test': 'preserved' }) },
    '@/lib/falErrors': { describeFalError: error => error.message },
  }).POST;
}
const post = (handler, body = completionBody) => handler({ json: async () => body });

for (const mode of ['text', 'image', 'reference']) {
  test(`${mode} generation submits native draft=true at 480p and preserves original inputs`, async () => {
    const db = database(); const submitted = [];
    const handler = load('src/app/api/fal/generate/route.ts', {
      'next/server': next, '@/lib/supabase/server': { createClient: async () => db },
      '@fal-ai/client': { fal: { config() {}, queue: { submit: async (endpoint, request) => {
        submitted.push({ endpoint, ...request }); return { request_id: 'draft-request' };
      } } } },
      '@/lib/api/models': { FAL_MODELS: { 'seedance-2-5': { type: 'video',
        endpoint: 'bytedance/seedance-2.5/text-to-video', imageToVideoEndpoint: 'bytedance/seedance-2.5/image-to-video' } } },
      '@/lib/api/referenceVideo': referenceConfig, '@/lib/generationAttempt': { registerGenerationAttempt: async () => {} },
      '@/lib/falStorage': { getFalStorageHeaders: async () => ({}) }, '@/lib/falErrors': { describeFalError: String },
      '@/lib/falPricing': {}, '@/lib/gptImage26': { currentImageModel: model => model },
    }).POST;
    const body = { model: 'seedance-2-5', prompt: 'Original scene', draft: true, videoResolution: '1080p',
      aspectRatio: '16:9', duration: 10, sourceType: 'canvas', sourceId: 'flow', nodeId: 'node',
      ...(mode === 'image' ? { startFrameUrl: 'start.png', endFrameUrl: 'end.png' } : {}),
      ...(mode === 'reference' ? { generationMode: 'reference-to-video', referenceDuration: 10,
        referenceImageUrls: ['image.png'], referenceVideoUrls: ['motion.mp4'] } : {}),
    };
    assert.equal((await post(handler, body)).status, 200);
    assert.equal(submitted[0].endpoint, `bytedance/seedance-2.5/${mode === 'reference' ? 'reference' : mode}-to-video`);
    assert.equal(submitted[0].input.draft, true);
    assert.equal(submitted[0].input.resolution, '480p');
    assert.equal(db.rows[0].parameters.resolution, '480p');
    assert.deepEqual(db.rows[0].parameters.input, submitted[0].input);
    if (mode === 'image') assert.equal(submitted[0].input.end_image_url, 'end.png');
    if (mode === 'reference') assert.deepEqual(submitted[0].input.video_urls, ['motion.mp4']);
    assert.equal((await post(handler, { ...body, draft: 'true' })).status, 400);
    assert.equal(submitted.length, 1);
    assert.equal((await post(handler, { ...body, draft: false })).status, 200);
    assert.equal(submitted[1].input.resolution, '1080p');
    assert.equal(submitted[1].input.draft, undefined);
  });
}

test('native drafts are limited to Seedance 2.5 and retain a fixed seven-day lifetime', () => {
  assert.throws(() => draftTools.validateSeedanceDraft('seedance-2', true), /only available/);
  assert.throws(() => referenceConfig.buildReferenceVideoInput({ model: 'seedance-2', draft: true }), /only available/);
  const row = draftRow();
  const metadata = videoGenerationMetadata(row);
  assert.equal(Date.parse(metadata.draftExpiresAt) - Date.parse(started), 7 * 86400_000);
  assert.equal(draftTools.canCompleteSeedanceDraft(metadata, Date.parse(metadata.draftExpiresAt) - 1), true);
  assert.equal(draftTools.canCompleteSeedanceDraft(metadata, Date.parse(metadata.draftExpiresAt)), false);
  const normal = saveVideoResultParameters({ draft: false }, { draft_id: 'unrelated' }, started);
  assert.equal(normal.draftId, undefined);
  assert.equal(draftTools.canCompleteSeedanceDraft({ ...metadata, draftId: undefined }), false);
});

test('completion uses the owned saved draft only and creates a separately billed recoverable job', async () => {
  const db = database([draftRow()]); const submitted = [], registered = [];
  const handler = completionRoute(db, async (endpoint, payload) => {
    submitted.push({ endpoint, ...payload }); return { request_id: 'hd-request' };
  }, async (_db, user, body) => registered.push({ user, body }));
  const response = await post(handler, { ...completionBody, draft_id: 'forged', prompt: 'Changed prompt', resolution: '4k' });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.endpoint, endpoint);
  assert.deepEqual(submitted, [{ endpoint, input: { draft_id: 'provider-draft', resolution: '1080p' }, headers: { 'storage-test': 'preserved' } }]);
  const final = db.rows.find(row => row.id === result.generationId);
  assert.equal(final.parameters.generationRunId, 'new-run');
  assert.equal(final.parameters.sourceDraftGenerationId, 'draft-gen');
  assert.equal(final.fal_request_id, 'hd-request');
  assert.equal(final.prompt, 'Original scene');
  assert.deepEqual(final.parameters.referenceVideoUrls, ['motion.mp4']);
  assert.deepEqual(final.parameters.input, input);
  assert.equal(final.parameters.draft, false);
  assert.equal(final.parameters.falBilling, undefined);
  assert.equal(db.rows[0].media_url, 'draft.mp4');
  assert.equal(registered.length, 1);
  assert.equal((await post(handler)).status, 409);
  final.status = 'completed';
  assert.equal((await post(handler)).status, 409);
  assert.equal(submitted.length, 1);
});

test('concurrent completion requests reserve the draft atomically before paid submission', async () => {
  const db = database([draftRow()]); let count = 0;
  const handler = completionRoute(db, async () => { count++; return { request_id: 'hd-request' }; });
  const results = await Promise.all([post(handler), post(handler, { ...completionBody, generationRunId: 'other-run' })]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(count, 1);
});

test('missing, foreign, expired, non-draft and unsigned requests never reach the paid queue', async () => {
  let calls = 0;
  const submit = async () => { calls++; return { request_id: 'should-not-queue' }; };
  for (const [row, options, expected] of [
    [draftRow(), { authenticated: false }, 401],
    [draftRow({ user_id: 'other-user' }), {}, 404],
    [draftRow({ parameters: { draft: false } }), {}, 400],
    [draftRow({ status: 'processing' }), {}, 400],
    [draftRow({ parameters: { ...draftRow().parameters, draftExpiresAt: '2000-01-01T00:00:00Z' } }), {}, 410],
  ]) {
    assert.equal((await post(completionRoute(database([row], options), submit))).status, expected);
  }
  assert.equal((await post(completionRoute(database([draftRow()]), submit), { ...completionBody, generationRunId: undefined })).status, 400);
  assert.equal(calls, 0);
});

test('confirmed provider failures can retry, but ambiguous network errors cannot double-charge', async () => {
  for (const ambiguous of [false, true]) {
    const db = database([draftRow()]); let calls = 0;
    const handler = completionRoute(db, async () => {
      if (++calls === 1) throw ambiguous ? new Error('Network disconnected')
        : new ApiError({ status: 422, message: 'Rejected', body: {} });
      return { request_id: 'retry-request' };
    });
    assert.equal((await post(handler)).status, 500);
    assert.equal((await post(handler)).status, ambiguous ? 409 : 200);
    assert.equal(calls, ambiguous ? 1 : 2);
  }
  const db = database([draftRow()]);
  const handler = completionRoute(db);
  await post(handler);
  db.rows[1].status = 'failed'; // The status poller confirmed inference failure.
  assert.equal((await post(handler, { ...completionBody, generationRunId: 'retry-run' })).status, 200);
});

test('a database failure before submission releases the reservation without spending money', async () => {
  const db = database([draftRow()], { rejectInsert: true }); let calls = 0;
  assert.equal((await post(completionRoute(db, async () => { calls++; }))).status, 500);
  assert.equal(calls, 0);
  assert.equal(db.rows[0].parameters.draftCompletionGenerationId, undefined);
});

test('fresh and cached status responses preserve the draft ID, seed and original expiry', async () => {
  const row = draftRow({ status: 'processing' });
  delete row.parameters.draftId; delete row.parameters.draftExpiresAt;
  const db = database([row]); let polls = 0;
  const route = load('src/app/api/fal/status/[requestId]/route.ts', {
    'next/server': next, '@/lib/supabase/server': { createClient: async () => db },
    '@fal-ai/client': { ApiError, fal: { config() {}, queue: { status: async () => { polls++; return { status: 'COMPLETED', response_url: 'result' }; } } } },
    '@/lib/gcs': { isGcsRef: () => false, getSignedReadUrl: async () => 'stored.mp4' },
    '@/lib/mediaDerivatives': { uploadMediaToGCS: async () => 'stored.mp4' },
    '@/lib/falErrors': { describeFalError: String, isTerminalFalError: () => false },
    '@/lib/generationFailures': {}, '@/lib/falRecovery': {},
    '@/lib/falResult': {
      fetchFalQueueResult: async () => ({ data: { video: { url: 'provider.mp4' }, seed: 17, draft_id: 'provider-draft' } }),
      getFalBillingColumns: async () => ({ fal_cost_usd: 2.15 }),
      mergeFalBillingParameters: (p, b) => ({ ...p, falBilling: b }), persistFalBillingBestEffort: async () => {},
    },
  });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array([1, 2]));
  try {
    const args = [{ nextUrl: new URL('https://example.com/status?mediaType=video') }, { params: Promise.resolve({ requestId: 'draft-request' }) }];
    const first = await (await route.GET(...args)).json();
    row.parameters.draftCompletionGenerationId = 'reserved-final';
    const cached = await (await route.GET(...args)).json();
    assert.deepEqual(cached.videoMetadata, first.videoMetadata);
    assert.equal(first.videoMetadata.draftId, 'provider-draft');
    assert.equal(first.videoMetadata.seed, 17);
    assert.equal(first.videoMetadata.generationId, 'draft-gen');
    assert.equal(row.parameters.draftCompletionGenerationId, 'reserved-final');
    assert.equal(polls, 1);
  } finally { globalThis.fetch = previousFetch; }
});

test('legacy history stays aligned, and repeated recovery cannot duplicate a result', () => {
  const draft = videoGenerationMetadata(draftRow());
  const first = draftTools.appendVideoResult(['old.mp4'], undefined, 'draft.mp4', draft);
  assert.deepEqual(first.videoHistoryMetadata, [null, draft]);
  const final = { generationId: 'final-gen', resolution: '1080p', sourceDraftGenerationId: draft.generationId };
  const completed = draftTools.appendVideoResult(first.videoHistory, first.videoHistoryMetadata, 'final.mp4', final);
  const recovered = draftTools.appendVideoResult(completed.videoHistory, completed.videoHistoryMetadata, 'resigned-final.mp4', final);
  assert.deepEqual(recovered.videoHistory, ['old.mp4', 'draft.mp4', 'resigned-final.mp4']);
  assert.equal(recovered.videoHistoryMetadata[1].draftId, 'provider-draft');
  assert.equal(recovered.videoHistoryMetadata[2].sourceDraftGenerationId, 'draft-gen');
});

test('draft and completion pricing use separate rates and include saved reference video duration', () => {
  const pricing = load('src/lib/falPricing.ts');
  const models = load('src/lib/api/models.ts', { './referenceVideo': referenceConfig,
    '@/lib/promptTags': {}, '@/lib/layerize': { LAYERIZE_ENDPOINT: 'unused' } });
  function estimate(endpoint, resolution, referenceVideos = []) {
    return pricing.estimateFalCost(referenceConfig.getReferenceVideoEstimatePrice(endpoint), models.getFalPricingRule(endpoint),
      { endpoint, resolution, duration: 10, aspectRatio: '16:9', referenceVideos });
  }
  const preview = estimate('bytedance/seedance-2.5/text-to-video', '480p');
  const final = estimate(endpoint, '1080p');
  assert.ok(preview > 2 && preview < 2.3);
  assert.ok(final > 11 && final < 12);
  assert.ok(preview < final / 5);
  assert.ok(Math.abs(estimate(endpoint, '1080p', [{ width: 1280, height: 720, duration: 10 }]) - final * 2 * 0.6) < 1e-10);
  assert.equal(estimate(endpoint, '1080p', [null]), null);
  assert.ok(models.getFalPricingEndpointIds().includes(endpoint));
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
function controls() {
  const requests = [], estimates = [];
  const useFlowStore = selector => selector({ currentFlow: { id: 'flow', title: 'Flow' } });
  useFlowStore.getState = () => ({ consumeGcsOnlyEligibility() {} });
  return { requests, estimates, ...load('src/components/canvas/nodes/SeedanceDraftControls.tsx', {
    react: { useEffect() {}, useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}] },
    '@/lib/stores/flowStore': { useFlowStore },
    '@/lib/generationTracker': { startTrackedVideoGeneration: request => requests.push(request) },
    '@/lib/useMediaMetadata': { useMediaMetadata: urls => new Map(urls.map(url => [url, { width: 1280, height: 720, duration: 6 }])) },
    '@/lib/useFalCostEstimate': { useFalCostEstimateValue: input => { estimates.push(input); return 7; } },
    '@/lib/falPricing': load('src/lib/falPricing.ts'), '@/lib/utils/cn': { cn: (...args) => args.filter(Boolean).join(' ') },
    './ExpensiveGenerationDialog': { ExpensiveGenerationDialog: () => null },
    './ImageGenerationGlass.module.css': {},
  }) };
}
for (const nodeType of ['videoGenNode', 'referenceVideoNode']) {
  test(`${nodeType}: HD action uses the selected draft's original settings after inputs/model change`, () => {
    const c = controls();
    const metadata = videoGenerationMetadata(draftRow());
    const tree = c.SeedanceDraftActions({ nodeId: 'node', nodeType, historyIndex: 0, isGenerating: false,
      onSelectVersion() {}, data: { model: 'wan-3-prime', prompt: 'Changed', duration: 30, referenceVideoUrls: ['new.mp4'],
        videoHistory: ['draft.mp4', 'another.mp4'], videoHistoryMetadata: [metadata, { ...metadata, generationId: 'another' }] } });
    const button = elements(tree).find(el => el.type === 'button');
    assert.equal(button.props.disabled, false);
    assert.match(textContent(tree), /480p Draft/);
    assert.match(textContent(button), /Generate 1080p/);
    button.props.onClick();
    assert.equal(c.requests.length, 1);
    assert.equal(c.requests[0].submissionUrl, '/api/fal/draft/complete');
    assert.equal(c.requests[0].nodeType, nodeType);
    assert.equal(c.requests[0].payload.draftGenerationId, 'draft-gen');
    assert.equal(c.requests[0].payload.prompt, undefined);
    assert.equal(c.estimates[0].duration, 10);
    assert.equal(c.estimates[0].referenceVideos[0].duration, 6);
  });
}
test('expired drafts disable HD; a linked final navigates history without another paid call', () => {
  const c = controls(), selected = [];
  const metadata = { ...videoGenerationMetadata(draftRow()), draftExpiresAt: '2000-01-01T00:00:00Z' };
  const props = { nodeId: 'node', nodeType: 'videoGenNode', historyIndex: 0, isGenerating: false,
    onSelectVersion: index => selected.push(index), data: { videoHistory: ['draft.mp4'], videoHistoryMetadata: [metadata] } };
  const expired = c.SeedanceDraftActions(props);
  assert.equal(elements(expired).find(el => el.type === 'button').props.disabled, true);
  assert.match(textContent(expired), /Draft expired/);
  props.data.videoHistory.push('final.mp4');
  props.data.videoHistoryMetadata.push({ generationId: 'final-gen', sourceDraftGenerationId: 'draft-gen' });
  const completed = c.SeedanceDraftActions(props);
  const view = elements(completed).find(el => el.type === 'button');
  assert.match(textContent(view), /View 1080p version/);
  view.props.onClick();
  assert.deepEqual(selected, [1]);
  assert.equal(c.requests.length, 0);
  assert.equal(c.SeedanceDraftActions({ ...props, data: { videoHistory: ['legacy.mp4'] } }), null);
});
