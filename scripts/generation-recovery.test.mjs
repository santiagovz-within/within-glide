import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(path, dependencies = {}) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const loadedModule = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(
    name => name in dependencies ? dependencies[name] : require(name), loadedModule, loadedModule.exports,
  );
  return loadedModule.exports;
}
const json = (body, status = 200) => Response.json(body, { status });
const daysAgo = Date.now() - 4 * 24 * 60 * 60 * 1000;
function job(overrides = {}) {
  return { id: 'flow:node', flowId: 'flow', nodeId: 'node', flowTitle: 'Flow',
    nodeType: 'videoGenNode', kind: 'video-generation', phase: 'processing', startedAt: daysAgo,
    slotCount: 1, slots: [null], failedSlots: [], submissionsComplete: true,
    imageHistory: [], videoHistory: [], requests: [{ requestId: 'request', endpoint: 'fal-ai/video',
      slotIndex: 0, mediaType: 'video', status: 'pending' }], ...overrides };
}
function harness(initial = job()) {
  const storage = new Map();
  globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) };
  const generation = load('src/lib/stores/generationStore.ts');
  const flow = load('src/lib/stores/flowStore.ts', { '@/lib/stores/generationStore': generation });
  const tracker = load('src/lib/generationTracker.ts', {
    '@/lib/stores/generationStore': generation, '@/lib/stores/flowStore': flow,
    '@/lib/utils/sound': { playSuccessSound() {} },
    '@/lib/imageGenerationResults': load('src/lib/imageGenerationResults.ts'),
  });
  if (initial) generation.useGenerationStore.getState().startJob(initial);
  const state = () => generation.useGenerationStore.getState();
  const flowState = () => flow.useFlowStore.getState();
  globalThis.document = { dispatchEvent() {} };
  return { ...tracker, state, flowState };
}
function recovered(overrides = {}) {
  return { flowId: 'flow', nodeId: 'node', flowTitle: 'Flow', nodeType: 'videoGenNode',
    nodeData: { status: 'processing', pendingRequestId: 'request', pendingEndpoint: 'fal-ai/video' },
    requestId: 'request', endpoint: 'fal-ai/video', mediaType: 'video', createdAt: new Date(daysAgo).toISOString(), ...overrides };
}

for (const response of [{ status: 'pending' }, { status: 'error', error: 'Temporary outage' }]) {
  test(`multi-day job remains active for ${response.status}, regardless of polling error count`, async () => {
    const h = harness();
    h.state().patchRequest('flow:node', 'request', { pollErrorCount: 999 });
    globalThis.fetch = async () => json(response, response.status === 'error' ? 503 : 200);
    await h.progressBackgroundGenerations();
    assert.equal(h.state().jobs['flow:node'].requests[0].status, 'pending');
    assert.deepEqual(h.state().jobs['flow:node'].failedSlots, []);
  });
}
for (const result of [{ status: 'completed', mediaUrls: ['https://example.com/video.mp4'] }, { status: 'failed', error: 'Rejected' }]) {
  test(`persisted ${result.status} clears the banner and saves final node data`, async () => {
    const h = harness(); const saves = [];
    globalThis.fetch = async (url, options) => {
      if (options?.method === 'PATCH') { saves.push(JSON.parse(options.body)); return json({ ok: true }); }
      return json(result);
    };
    await h.progressBackgroundGenerations();
    assert.equal(h.state().jobs['flow:node'], undefined);
    assert.equal(saves[0].data.status, result.status === 'failed' ? 'error' : 'completed');
    assert.ok(saves[0].unset.includes('pendingRequestId'));
  });
}
test('partial submission recovered after reload finalizes missing slots without killing known long-running requests', async () => {
  const h = harness(job({ submissionsComplete: false, slotCount: 2, slots: [null, null] }));
  globalThis.fetch = async () => json({ status: 'pending' });
  await h.progressBackgroundGenerations();
  assert.equal(h.state().jobs['flow:node'].submissionsComplete, true);
  assert.equal(h.state().jobs['flow:node'].requests[0].status, 'pending');
  const saves = [];
  globalThis.fetch = async (url, options) => {
    if (options?.method === 'PATCH') { saves.push(JSON.parse(options.body)); return json({}); }
    return json({ status: 'completed', mediaUrls: ['https://example.com/video.mp4'] });
  };
  await h.progressBackgroundGenerations();
  assert.equal(h.state().jobs['flow:node'], undefined);
  assert.equal(saves[0].data.status, 'error');
});
test('server-confirmed deleted node removes a persisted job, but empty pending list alone does not', async () => {
  const h = harness();
  globalThis.fetch = async () => json({ generations: [] });
  await h.recoverBackgroundGenerations();
  assert.ok(h.state().jobs['flow:node']);
  globalThis.fetch = async () => json({ generations: [], removedJobIds: ['flow:node'] });
  await h.recoverBackgroundGenerations();
  assert.equal(h.state().jobs['flow:node'], undefined);
});
test('recovery failure leaves jobs intact and newly unsaved open nodes are protected', async () => {
  const h = harness();
  h.flowState().setCurrentFlow({ id: 'flow', flow_data: { nodes: [{ id: 'node', data: {} }], edges: [] } });
  globalThis.fetch = async () => json({ generations: [], removedJobIds: ['flow:node'] });
  await h.recoverBackgroundGenerations();
  assert.ok(h.state().jobs['flow:node']);
  globalThis.fetch = async () => json({ error: 'DB unavailable' }, 500);
  await h.recoverBackgroundGenerations();
  assert.ok(h.state().jobs['flow:node']);
});
for (const mode of ['removeNode', 'onNodesChange', 'setNodes']) {
  test(`${mode} immediately clears a deleted node's banner, including the last node`, () => {
    const h = harness();
    h.flowState().setCurrentFlow({ id: 'flow', flow_data: { nodes: [{ id: 'node', data: {} }], edges: [] } });
    if (mode === 'removeNode') h.flowState().removeNode('node');
    if (mode === 'onNodesChange') h.flowState().onNodesChange([{ id: 'node', type: 'remove' }]);
    if (mode === 'setNodes') h.flowState().setNodes([]);
    assert.equal(h.state().jobs['flow:node'], undefined);
  });
}
test('navigation away does not delete active jobs', () => {
  const h = harness(); h.flowState().setCurrentFlow(null);
  assert.ok(h.state().jobs['flow:node']);
});
test('recovery cannot resurrect a node deleted locally before autosave', async () => {
  const h = harness(null);
  h.flowState().setCurrentFlow({ id: 'flow', flow_data: { nodes: [], edges: [] } });
  globalThis.fetch = async () => json({ generations: [recovered()] });
  await h.recoverBackgroundGenerations();
  assert.deepEqual(h.state().jobs, {});
});
test('recovery preserves terminal requests and saving jobs', async () => {
  const h = harness(job({ requests: [{ ...job().requests[0], status: 'completed' }], slots: ['url'] }));
  globalThis.fetch = async () => json({ generations: [recovered()] });
  await h.recoverBackgroundGenerations();
  assert.equal(h.state().jobs['flow:node'].requests[0].status, 'completed');
  h.state().patchJob('flow:node', { phase: 'saving' });
  await h.recoverBackgroundGenerations();
  assert.equal(h.state().jobs['flow:node'].phase, 'saving');
});
test('recovery restores completed slots in a partial image batch', async () => {
  const h = harness(null);
  globalThis.fetch = async () => json({ generations: [recovered({ nodeType: 'imageGenNode', slotIndex: 1, mediaType: 'image',
    nodeData: { numImages: 2, generationSlots: ['https://example.com/first.png', null], pendingRequests: [{ requestId: 'request' }] } })] });
  await h.recoverBackgroundGenerations();
  assert.deepEqual(h.state().jobs['flow:node'].slots, ['https://example.com/first.png', null]);
  globalThis.fetch = async (url, options) => options?.method === 'PATCH' ? json({}) : json({ status: 'completed', mediaUrls: ['https://example.com/second.png'] });
  await h.progressBackgroundGenerations();
  assert.equal(h.state().jobs['flow:node'], undefined);
});
test('late poll for deleted/replaced job cannot mutate the replacement', async () => {
  const h = harness(); let resolve;
  globalThis.fetch = () => new Promise(r => { resolve = r; });
  const polling = h.progressBackgroundGenerations();
  h.state().startJob(job({ startedAt: Date.now(), requests: [{ ...job().requests[0], requestId: 'new' }] }));
  resolve(json({ status: 'completed', mediaUrls: ['old-result'] }));
  await polling;
  assert.deepEqual(h.state().jobs['flow:node'].slots, [null]);
});
test('live slow submission is not orphaned by recovery or progress', async () => {
  const h = harness(null); let resolveSubmission;
  globalThis.fetch = (url) => {
    if (url === '/api/fal/generate') return new Promise(resolve => { resolveSubmission = resolve; });
    if (url === '/api/generations/pending') return Promise.resolve(json({ generations: [recovered()] }));
    return Promise.resolve(json({ status: 'pending' }));
  };
  const submitting = h.startTrackedVideoGeneration({ flowId: 'flow', flowTitle: 'Flow', nodeId: 'node', data: {}, endpoint: 'fal-ai/video', payload: {} });
  const realNow = Date.now;
  Date.now = () => realNow() + 20 * 60 * 1000;
  try {
    await h.recoverBackgroundGenerations();
    await h.progressBackgroundGenerations();
    assert.equal(h.state().jobs['flow:node'].submissionsComplete, false);
  } finally { Date.now = realNow; }
  resolveSubmission(json({ requestId: 'request', endpoint: 'fal-ai/video' }));
  await submitting;
  assert.equal(h.state().jobs['flow:node'].submissionsComplete, true);
});

// Exercise the actual route handlers with a small query adapter. No credentials
// or paid model invocations are needed to cover provider and database failures.
function database(tables, { failTable, failUpdates = false } = {}) {
  return { auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) }, from(table) {
    let filters = [], update, range, single = false; const orders = [];
    const q = {
      select() { return q; },
      eq(key, value) { filters.push(row => row[key] === value); return q; },
      not(key, op, value) { filters.push(row => row[key] !== value && row[key] !== undefined); return q; },
      in(key, values) { filters.push(row => values.includes(row[key])); return q; },
      contains(key) {
        filters.push(row => row[key]?.nodes?.some(node => node.data?.status === 'processing'));
        return q;
      },
      order(key) { orders.push(key); return q; },
      range(a, b) { range = [a, b]; return q; },
      maybeSingle() { single = true; return q; },
      single() { single = true; return q; },
      update(values) { update = values; return q; },
      then(resolve, reject) { return Promise.resolve().then(() => {
        if (table === failTable || (update && failUpdates)) return { data: null, error: { message: 'Database unavailable' } };
        let rows = (tables[table] ?? []).filter(row => filters.every(f => f(row)));
        if (update) rows.forEach(row => Object.assign(row, update));
        rows.sort((a, b) => { for (const key of orders) { const cmp = String(a[key]).localeCompare(String(b[key])); if (cmp) return cmp; } return 0; });
        rows = range ? rows.slice(range[0], range[1] + 1) : rows.slice(0, 1000);
        return { data: single ? rows[0] ?? null : rows, error: null };
      }).then(resolve, reject); },
    };
    return q;
  } };
}
const next = { NextResponse: { json: (body, options) => json(body, options?.status ?? 200) } };
const falErrors = load('src/lib/falErrors.ts');
const { ApiError } = require('@fal-ai/client');
function statusRoute(db, providerStatus, providerResult) {
  const failures = load('src/lib/generationFailures.ts', { 'next/server': next });
  return load('src/app/api/fal/status/[requestId]/route.ts', {
    'next/server': next, '@/lib/supabase/server': { createClient: async () => db },
    '@fal-ai/client': { ApiError, fal: { config() {}, queue: { status: async () => {
      if (providerStatus instanceof Error) throw providerStatus;
      return providerStatus;
    } } } },
    '@/lib/gcs': { isGcsRef: () => false }, '@/lib/mediaDerivatives': {},
    '@/lib/falErrors': falErrors, '@/lib/generationFailures': failures,
    '@/lib/falResult': { fetchFalQueueResult: async () => {
      if (providerResult instanceof Error) throw providerResult;
      return providerResult;
    } },
  });
}
const request = { nextUrl: new URL('https://example.com/api/fal/status/request?endpoint=fal-ai/video') };
const params = { params: Promise.resolve({ requestId: 'request' }) };
function row(overrides = {}) {
  return { id: 'gen', user_id: 'user', fal_request_id: 'request', status: 'processing',
    created_at: new Date(daysAgo).toISOString(), parameters: { endpoint: 'fal-ai/video' }, ...overrides };
}
for (const status of ['IN_QUEUE', 'IN_PROGRESS']) {
  test(`status endpoint keeps ${status} pending after days`, async () => {
    const db = database({ generations: [row()] });
    const response = await statusRoute(db, { status }).GET(request, params);
    assert.equal((await response.json()).status, 'pending');
  });
}
for (const status of [401, 403, 408, 429, 500, 502, 503, 504]) {
  test(`status-service HTTP ${status} remains retryable`, async () => {
    const generation = row();
    const response = await statusRoute(database({ generations: [generation] }), new ApiError({ status, message: 'Unavailable', body: { detail: 'Unavailable' } })).GET(request, params);
    assert.equal(response.status, 500);
    assert.equal((await response.json()).status, 'error');
    assert.equal(generation.status, 'processing');
  });
}
for (const status of [404, 410]) {
  test(`confirmed missing/expired request HTTP ${status} persists failure without an age cutoff on active jobs`, async () => {
    const generation = row();
    const response = await statusRoute(database({ generations: [generation] }), new ApiError({ status, message: 'Missing' })).GET(request, params);
    assert.equal((await response.json()).status, 'failed');
    assert.equal(generation.status, 'failed');
  });
}
test('new request missing from fal has a visibility grace period', async () => {
  const generation = row({ created_at: new Date().toISOString() });
  const response = await statusRoute(database({ generations: [generation] }), new ApiError({ status: 404, message: 'Missing' })).GET(request, params);
  assert.equal(response.status, 500);
  assert.equal(generation.status, 'processing');
});
for (const providerStatus of [{ status: 'COMPLETED', error: 'Inference timeout', error_type: 'timeout' }, { status: 'CANCELLED' }, { status: 'FAILED' }]) {
  test(`provider ${JSON.stringify(providerStatus)} persists terminal failure`, async () => {
    const generation = row();
    const response = await statusRoute(database({ generations: [generation] }), providerStatus).GET(request, params);
    assert.equal((await response.json()).status, 'failed');
    assert.equal(generation.status, 'failed');
  });
}
for (const status of ['completed', 'failed']) {
  test(`saved ${status} is authoritative even if fal is unavailable`, async () => {
    const response = await statusRoute(database({ generations: [row({ status, media_url: 'https://example.com/result.mp4' })] }), new Error('Must not call fal')).GET(request, params);
    assert.equal((await response.json()).status, status);
  });
}
test('failure persistence errors do not report success', async () => {
  const { failGeneration } = load('src/lib/generationFailures.ts', { 'next/server': next });
  await assert.rejects(() => failGeneration(database({ generations: [row()] }, { failUpdates: true }), 'user', 'request', 'Failed'), /Could not persist/);
});
test('explicit fal timeout is terminal; auth errors and generic gateway timeouts are retryable', () => {
  assert.equal(falErrors.isTerminalFalError(new ApiError({ status: 504, timeoutType: 'user', message: 'Timed out' })), true);
  for (const status of [401, 403, 429, 503, 504]) {
    assert.equal(falErrors.isTerminalFalError(new ApiError({ status, message: 'Unavailable', body: { detail: 'Unavailable' } })), false);
  }
});
function pendingRoute(db) {
  return load('src/app/api/generations/pending/route.ts', {
    'next/server': next, '@/lib/supabase/server': { createClient: async () => db, createAdminClient: () => db }, '@/lib/api/models': { FAL_MODELS: {} },
  });
}
test('recovery API includes multi-day jobs, saved terminal results and pages beyond 500; excludes deleted/finished/other-user nodes', async () => {
  const flows = [], generations = [];
  for (let i = 0; i < 501; i++) {
    flows.push({ id: `flow-${i}`, title: 'Flow', user_id: 'user', flow_data: { nodes: [{ id: 'node', type: 'videoGenNode', data: { status: 'processing', pendingRequestId: `req-${i}`, pendingEndpoint: 'fal-ai/video' } }] } });
    generations.push(row({ id: `gen-${i}`, source_type: 'canvas', source_id: `flow-${i}`, node_id: 'node', media_type: 'video', fal_request_id: `req-${i}`, model: 'model' }));
  }
  generations[0].status = 'completed';
  generations[1].status = 'failed';
  flows[2].flow_data.nodes = [];
  flows[3].flow_data.nodes[0].data = { status: 'completed' };
  flows[4].user_id = 'another-user'; generations[4].user_id = 'another-user';
  const response = await pendingRoute(database({ flows, generations })).POST({ json: async () => ({ jobs: [{ id: 'deleted', flowId: 'flow-2', nodeId: 'node' }, { id: 'active', flowId: 'flow-500', nodeId: 'node' }, { id: 'deleted-flow', flowId: 'gone', nodeId: 'node' }] }) });
  const result = await response.json();
  assert.equal(result.generations.length, 498);
  for (const id of ['req-0', 'req-1', 'req-500']) assert.ok(result.generations.some(g => g.requestId === id));
  assert.deepEqual(result.removedJobIds, ['deleted', 'deleted-flow']);
});
test('database lookup failure cannot claim nodes were removed', async () => {
  const response = await pendingRoute(database({}, { failTable: 'flows' })).POST({ json: async () => ({ jobs: [{ id: 'job', flowId: 'flow', nodeId: 'node' }] }) });
  assert.equal(response.status, 500);
  assert.equal((await response.json()).removedJobIds, undefined);
});

test('missing local generation record does not stop a provider-confirmed running job', async () => {
  const response = await statusRoute(database({ generations: [] }), { status: 'IN_PROGRESS' }).GET(request, params);
  assert.equal((await response.json()).status, 'pending');
});

test('recovered partial batch keeps successful images in history and propagates them after another slot fails', async () => {
  const h = harness(null);
  const nodeData = { status: 'processing', numImages: 2,
    generationHistory: [['https://example.com/older.png']],
    generationSlots: ['https://example.com/success.png', null],
    pendingRequests: [{ requestId: 'request', slotIndex: 1, endpoint: 'fal-ai/image' }] };
  h.flowState().setCurrentFlow({ id: 'flow', flow_data: {
    nodes: [{ id: 'node', type: 'imageGenNode', data: nodeData }], edges: [],
  } });
  const events = [], saves = [];
  globalThis.document = { dispatchEvent: event => events.push(event) };
  globalThis.fetch = async () => json({ generations: [recovered({
    nodeType: 'imageGenNode', slotIndex: 1, mediaType: 'image', nodeData,
  })] });
  await h.recoverBackgroundGenerations();
  globalThis.fetch = async (url, options) => {
    if (options?.method === 'PATCH') { saves.push(JSON.parse(options.body)); return json({ ok: true }); }
    return json({ status: 'failed', error: 'Rejected' });
  };
  await h.progressBackgroundGenerations();
  assert.equal(h.state().jobs['flow:node'], undefined);
  assert.equal(saves[0].data.status, 'error');
  assert.deepEqual(saves[0].data.generatedImages, ['https://example.com/success.png']);
  assert.deepEqual(saves[0].data.generationHistory, [
    ['https://example.com/older.png'], ['https://example.com/success.png'],
  ]);
  assert.equal(events[0].type, 'node:image-propagate');
  assert.equal(events[0].detail.imageUrl, 'https://example.com/success.png');
});
