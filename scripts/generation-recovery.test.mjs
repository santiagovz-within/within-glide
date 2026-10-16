import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(path, dependencies = {}) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
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
    '@/lib/flowMedia': { signFlowMedia: async value => value },
    '@/lib/generationReconciliation': load('src/lib/generationReconciliation.ts'),
    '@/lib/imageGenerationResults': load('src/lib/imageGenerationResults.ts'),
  });
  if (initial) generation.useGenerationStore.getState().startJob(initial);
  const state = () => generation.useGenerationStore.getState();
  const flowState = () => flow.useFlowStore.getState();
  globalThis.document = { dispatchEvent() {} };
  return { ...tracker, state, flowState, storage, hydrate: () => generation.useGenerationStore.persist.rehydrate(), subscribe: generation.useGenerationStore.subscribe };
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
  h.state().patchRequest('flow:node', 'request', { nextPollAt: 0 });
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
  const h = harness(null);
  h.flowState().setCurrentFlow({ id: 'flow', flow_data: { nodes: [], edges: [] } });
  h.flowState().setNodes([{ id: 'node', data: {} }]);
  h.state().startJob(job());
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
  globalThis.fetch = async (url, options) => options?.method === 'PATCH'
    ? json({ error: 'Temporary save failure' }, 500) : json({ generations: [recovered()] });
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
function database(tables, { failTable, failUpdates = false, beforeUpdate } = {}) {
  return { auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) }, from(table) {
    let filters = [], update, range, single = false; const orders = [];
    const q = {
      select() { return q; },
      eq(key, value) { filters.push(row => row[key] === value); return q; },
      not(key, op, value) { filters.push(row => row[key] !== value && row[key] !== undefined); return q; },
      in(key, values) { filters.push(row => values.includes(key === 'parameters->>generationRunId' ? row.parameters?.generationRunId : row[key])); return q; },
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
        if (update) beforeUpdate?.(table, update);
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
    '@/lib/flowMedia': { signFlowMedia: async value => value },
    '@/lib/generationReconciliation': load('src/lib/generationReconciliation.ts'),
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

const reconciliation = load('src/lib/generationReconciliation.ts');
const oldPending = { status: 'processing', pendingRequestId: 'request', pendingEndpoint: 'fal-ai/video' };
const finished = { status: 'completed', videoUrl: 'gcs:result.mp4', resolvedRequestIds: ['request'] };
function flowRecord(data = oldPending) {
  return { id: 'flow', user_id: 'user', title: 'Vans', lifecycle_state: 'active', updated_at: '2026-01-01T00:00:00Z',
    flow_data: { nodes: [{ id: 'node', type: 'videoGenNode', position: { x: 0, y: 0 }, data }], edges: [] } };
}
function saveRoutes(db) {
  const dependencies = { 'next/server': next,
    '@/lib/supabase/server': { createClient: async () => db, createAdminClient: () => db },
    '@/lib/flowMedia': { signFlowMedia: async value => value },
    '@/lib/generationReconciliation': reconciliation,
    '@/lib/utils/flowPersistence': load('src/lib/utils/flowPersistence.ts'),
  };
  return {
    node: load('src/app/api/flows/[flowId]/nodes/[nodeId]/route.ts', dependencies).PATCH,
    canvas: load('src/app/api/flows/[flowId]/autosave/route.ts', dependencies).PATCH,
  };
}
const nodeParams = { params: Promise.resolve({ flowId: 'flow', nodeId: 'node' }) };
const bodyRequest = body => ({ json: async () => body });

test('historical terminal nodes with stale pending IDs never create generating cards', async () => {
  for (const status of ['completed', 'error']) {
    const flow = flowRecord({ ...oldPending, status });
    const generation = row({ source_type: 'canvas', source_id: 'flow', node_id: 'node', media_type: 'video', model: 'model' });
    const db = database({ flows: [flow], generations: [generation] });
    const response = await pendingRoute(db).POST(bodyRequest({ jobs: [{ id: 'flow:node', flowId: 'flow', nodeId: 'node', requestIds: ['request'] }] }));
    const result = await response.json();
    assert.deepEqual(result.generations, []);
    assert.deepEqual(result.removedJobIds, ['flow:node']);
    const h = harness();
    globalThis.fetch = async () => json(result);
    await h.recoverBackgroundGenerations();
    assert.deepEqual(h.state().jobs, {});
  }
});
test('recovery never guesses an attempt from old processing rows without matching IDs', async () => {
  const flow = flowRecord({ status: 'processing' });
  const generation = row({ source_type: 'canvas', source_id: 'flow', node_id: 'node', media_type: 'video', model: 'model' });
  const result = await (await pendingRoute(database({ flows: [flow], generations: [generation] })).GET()).json();
  assert.deepEqual(result.generations, []);
});
for (const status of ['completed', 'failed']) {
  test(`saved ${status} recovers directly without polling fal or briefly showing Generating`, async () => {
    const h = harness(null), phases = [], saves = [];
    h.subscribe(state => { phases.push(...Object.values(state.jobs).map(j => j.phase)); });
    globalThis.fetch = async (url, options) => {
      if (options?.method === 'PATCH') { saves.push(JSON.parse(options.body)); return json({ ok: true }); }
      assert.equal(url, '/api/generations/pending');
      return json({ generations: [recovered({ status, mediaUrl: status === 'completed' ? 'gcs:result.mp4' : undefined, errorMessage: 'Rejected' })] });
    };
    await h.recoverBackgroundGenerations();
    assert.deepEqual(h.state().jobs, {});
    assert.equal(saves[0].data.status, status === 'completed' ? 'completed' : 'error');
    assert.ok(!phases.includes('processing'));
    assert.ok(!phases.includes('submitting'));
  });
}
test('unverified recovery stays Checking with backoff until fal confirms the request is pending', async () => {
  const h = harness(null);
  h.flowState().setCurrentFlow(flowRecord(oldPending));
  globalThis.fetch = async () => json({ generations: [recovered()] });
  await h.recoverBackgroundGenerations();
  assert.equal(h.state().jobs['flow:node'].phase, 'checking');
  assert.equal(h.flowState().nodes[0].data.status, 'processing');
  let polls = 0;
  globalThis.fetch = async () => { polls++; return json({ error: 'Unavailable' }, 503); };
  await h.progressBackgroundGenerations();
  await h.progressBackgroundGenerations();
  assert.equal(polls, 1);
  assert.equal(h.state().jobs['flow:node'].phase, 'checking');
  assert.equal(h.flowState().nodes[0].data.status, 'processing');
  h.state().patchRequest('flow:node', 'request', { nextPollAt: 0 });
  globalThis.fetch = async () => json({ status: 'pending' });
  await h.progressBackgroundGenerations();
  assert.equal(h.state().jobs['flow:node'].phase, 'processing');
  assert.equal(h.flowState().nodes[0].data.status, 'processing');
});
test('rehydration requires fresh verification even for previously confirmed running jobs', async () => {
  const h = harness(job({ requests: [{ ...job().requests[0], lastVerifiedAt: Date.now() }] }));
  const persisted = h.storage.get('canvas-flow-background-generations');
  const reopened = harness(null);
  reopened.storage.set('canvas-flow-background-generations', persisted);
  await reopened.hydrate();
  assert.equal(reopened.state().jobs['flow:node'].phase, 'checking');
  assert.equal(reopened.state().jobs['flow:node'].requests[0].lastVerifiedAt, undefined);
});
test('completion followed by stale autosave and repeated recovery cannot resurrect the generation', async () => {
  const flow = flowRecord();
  const base = structuredClone(flow.flow_data.nodes);
  const generation = row({ source_type: 'canvas', source_id: 'flow', node_id: 'node', media_type: 'video', model: 'model', status: 'completed', media_url: 'gcs:result.mp4' });
  const db = database({ flows: [flow], generations: [generation] });
  const routes = saveRoutes(db);
  const response = await routes.node(bodyRequest({ requestIds: ['request'], data: finished, unset: ['pendingRequestId', 'pendingEndpoint'] }), nodeParams);
  assert.equal(response.status, 200);
  const lateSave = await routes.canvas(bodyRequest({ baseNodes: base, flowData: { nodes: base, edges: [] } }), nodeParams);
  assert.equal(lateSave.status, 200);
  assert.equal(flow.flow_data.nodes[0].data.status, 'completed');
  assert.equal(flow.flow_data.nodes[0].data.pendingRequestId, undefined);
  for (let i = 0; i < 3; i++) {
    const result = await (await pendingRoute(db).GET()).json();
    assert.deepEqual(result.generations, []);
  }
});
test('a newer run wins over delayed completion and older-tab autosave, preserving editable fields', async () => {
  const base = flowRecord({ ...oldPending, generationRunId: 'old-run' }).flow_data.nodes;
  const flow = flowRecord({ status: 'processing', generationRunId: 'new-run', pendingRequestId: 'new-request' });
  const routes = saveRoutes(database({ flows: [flow] }));
  const completion = await routes.node(bodyRequest({ generationRunId: 'old-run', requestIds: ['request'], data: finished }), nodeParams);
  assert.equal((await completion.json()).superseded, true);
  const incoming = structuredClone(base); incoming[0].data.prompt = 'Keep this edit';
  const saved = await routes.canvas(bodyRequest({ baseNodes: base, flowData: { nodes: incoming, edges: [] } }), nodeParams);
  assert.equal(saved.status, 200);
  assert.equal(flow.flow_data.nodes[0].data.generationRunId, 'new-run');
  assert.equal(flow.flow_data.nodes[0].data.pendingRequestId, 'new-request');
  assert.equal(flow.flow_data.nodes[0].data.prompt, 'Keep this edit');
});
test('new attempt finishing before autosave waits for its identity, then saves without losing output', async () => {
  const prior = { ...finished, generationRunId: 'old-run' };
  const flow = flowRecord(prior), db = database({ flows: [flow] }), routes = saveRoutes(db);
  const finalBody = { generationRunId: 'new-run', previousIdentity: 'old-run', requestIds: ['new-request'],
    data: { ...finished, generationRunId: 'new-run', videoUrl: 'gcs:new.mp4', resolvedRequestIds: ['new-request'] }, unset: ['pendingRequestId'] };
  const waiting = await routes.node(bodyRequest(finalBody), nodeParams);
  assert.equal(waiting.status, 409);
  const incoming = flowRecord({ status: 'processing', generationRunId: 'new-run', pendingRequestId: 'new-request' }).flow_data;
  const saved = await routes.canvas(bodyRequest({ baseNodes: flow.flow_data.nodes, flowData: incoming }), nodeParams);
  assert.equal(saved.status, 200);
  assert.equal((await routes.node(bodyRequest(finalBody), nodeParams)).status, 200);
  assert.equal(flow.flow_data.nodes[0].data.videoUrl, 'gcs:new.mp4');
});
test('stale autosave does not recreate a node deleted in another tab', async () => {
  const base = flowRecord().flow_data.nodes;
  const flow = flowRecord(); flow.flow_data.nodes = [];
  const routes = saveRoutes(database({ flows: [flow] }));
  assert.equal((await routes.canvas(bodyRequest({ baseNodes: base, flowData: { nodes: base, edges: [] } }), nodeParams)).status, 200);
  assert.deepEqual(flow.flow_data.nodes, []);
});
test('canvas autosave and node completion enforce ownership', async () => {
  const flow = flowRecord(); flow.user_id = 'someone-else';
  const routes = saveRoutes(database({ flows: [flow] }));
  assert.equal((await routes.canvas(bodyRequest({ baseNodes: [], flowData: { nodes: [], edges: [] } }), nodeParams)).status, 403);
  assert.equal((await routes.node(bodyRequest({ data: finished }), nodeParams)).status, 403);
});

test('an outdated recovery response cannot reopen a terminal node in the current canvas', async () => {
  const h = harness(null);
  h.flowState().setCurrentFlow(flowRecord(finished));
  globalThis.fetch = async () => json({ generations: [recovered()] });
  await h.recoverBackgroundGenerations();
  assert.deepEqual(h.state().jobs, {});
  assert.equal(h.flowState().nodes[0].data.status, 'completed');
});

test('autosave retries a concurrent completion and keeps its terminal state', async () => {
  const flow = flowRecord(), base = structuredClone(flow.flow_data.nodes);
  let writes = 0;
  const db = database({ flows: [flow] }, { beforeUpdate(table) {
    if (table !== 'flows' || ++writes !== 1) return;
    flow.flow_data = flowRecord(finished).flow_data;
    flow.updated_at = '2026-01-02T00:00:00Z';
  } });
  const response = await saveRoutes(db).canvas(bodyRequest({ baseNodes: base, flowData: { nodes: base, edges: [] } }), nodeParams);
  assert.equal(response.status, 200);
  assert.equal(writes, 2);
  assert.equal(flow.flow_data.nodes[0].data.status, 'completed');
  assert.equal(flow.flow_data.nodes[0].data.pendingRequestId, undefined);
});
test('a deletion during completion wins the optimistic retry without recreating the node', async () => {
  const flow = flowRecord(); let writes = 0;
  const db = database({ flows: [flow] }, { beforeUpdate(table) {
    if (table !== 'flows' || ++writes !== 1) return;
    flow.flow_data.nodes = []; flow.updated_at = '2026-01-02T00:00:00Z';
  } });
  const response = await saveRoutes(db).node(bodyRequest({ requestIds: ['request'], data: finished }), nodeParams);
  assert.equal(response.status, 404);
  assert.deepEqual(flow.flow_data.nodes, []);
});
test('background polling is bounded and does not starve later requests', async () => {
  const h = harness(null), seen = [], pending = [];
  for (let i = 0; i < 8; i++) h.state().startJob(job({ id: `flow:node-${i}`, nodeId: `node-${i}`,
    requests: [{ ...job().requests[0], requestId: `req-${i}` }] }));
  globalThis.fetch = url => { seen.push(url); return new Promise(resolve => pending.push(resolve)); };
  const first = h.progressBackgroundGenerations();
  assert.equal(seen.length, 4);
  await h.progressBackgroundGenerations();
  assert.equal(seen.length, 4);
  pending.splice(0).forEach(resolve => resolve(json({ status: 'pending' })));
  await first;
  const second = h.progressBackgroundGenerations();
  assert.equal(seen.length, 8);
  assert.equal(new Set(seen).size, 8);
  pending.splice(0).forEach(resolve => resolve(json({ status: 'pending' })));
  await second;
});
test('sidebar groups uncertain historical jobs separately from confirmed generating jobs', () => {
  const React = require('react');
  const state = { jobs: {} };
  for (let i = 0; i < 4; i++) state.jobs[`flow:${i}`] = job({ id: `flow:${i}`, phase: 'checking', flowTitle: 'Vans' });
  const { Sidebar } = load('src/components/layout/Sidebar.tsx', {
    'next/navigation': { usePathname: () => '/dashboard/canvas-flow' },
    'next/link': { __esModule: true, default: ({ children, href, ...props }) => React.createElement('a', { ...props, href: typeof href === 'string' ? href : href.pathname }, children) },
    'next/image': { __esModule: true, default: () => null },
    '@/lib/utils/cn': { cn: (...values) => values.filter(v => typeof v === 'string').join(' ') },
    '@/lib/supabase/client': {},
    '@/lib/stores/generationStore': { useGenerationStore: selector => selector(state) },
    '@/components/canvas/nodes/TypedHandle': { PORT_COLORS: { video: 'purple' } },
  });
  const { renderToStaticMarkup } = require('react-dom/server');
  const render = () => renderToStaticMarkup(React.createElement(Sidebar));
  assert.equal((render().match(/Generating asset/g) ?? []).length, 0);
  assert.equal((render().match(/Checking status \(/g) ?? []).length, 1);
  state.jobs.active = job({ id: 'active', phase: 'processing' });
  assert.equal((render().match(/Generating asset/g) ?? []).length, 1);
});
test('unknown provider statuses remain unverified rather than being reported as pending', async () => {
  const response = await statusRoute(database({ generations: [row()] }), { status: 'UNKNOWN' }).GET(request, params);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).status, 'error');
});

test('unrelated media input uploads are not blocked by generation reconciliation', () => {
  const base = [{ id: 'media', type: 'mediaInputNode', data: { status: 'completed', videoUrl: 'old.mp4' } }];
  const incoming = [{ ...base[0], data: { status: 'processing', videoUrl: 'new.mp4' } }];
  assert.deepEqual(reconciliation.mergeGenerationNodes(incoming, base, base), incoming);
});
test('a persisted new attempt can resume over its old completed node after verification', async () => {
  const h = harness(job({ runId: 'new-run', previousIdentity: 'old-run', phase: 'checking' }));
  h.flowState().setCurrentFlow(flowRecord({ ...finished, generationRunId: 'old-run' }));
  globalThis.fetch = async () => json({ status: 'pending' });
  await h.progressBackgroundGenerations();
  assert.equal(h.flowState().nodes[0].data.generationRunId, 'new-run');
  assert.equal(h.flowState().nodes[0].data.status, 'processing');
  assert.equal(h.state().jobs['flow:node'].phase, 'processing');
});
test('an exact unsaved attempt is recovered even when its callback and node autosave were lost', async () => {
  const flow = flowRecord({ ...finished, generationRunId: 'old-run' });
  const generation = row({ status: 'completed', media_url: 'gcs:new.mp4', source_type: 'canvas', source_id: 'flow',
    node_id: 'node', model: 'model', media_type: 'video', parameters: { endpoint: 'fal-ai/video', generationRunId: 'new-run' } });
  const result = await (await pendingRoute(database({ flows: [flow], generations: [generation] })).POST(bodyRequest({ jobs: [
    { id: 'flow:node', flowId: 'flow', nodeId: 'node', runId: 'new-run', previousIdentity: 'old-run', requestIds: [] },
  ] }))).json();
  assert.deepEqual(result.removedJobIds, []);
  assert.equal(result.generations.length, 1);
  assert.equal(result.generations[0].status, 'completed');
  assert.equal(result.generations[0].runId, 'new-run');
});

const { registerGenerationAttempt } = load('src/lib/generationAttempt.ts', {
  '@/lib/flowMedia': { signFlowMedia: async value => value },
    '@/lib/generationReconciliation': reconciliation,
});
test('registration reserves a run durably and is idempotent across image batch slots', async () => {
  const flow = flowRecord({ ...finished, generationRunId: 'old-run' });
  const db = database({ flows: [flow] });
  const input = { sourceType: 'canvas', sourceId: 'flow', nodeId: 'node', generationRunId: 'new-run', previousIdentity: 'old-run' };
  await registerGenerationAttempt(db, 'user', input);
  const version = flow.updated_at;
  assert.equal(flow.flow_data.nodes[0].data.generationRunId, 'new-run');
  assert.equal(flow.flow_data.nodes[0].data.status, 'processing');
  assert.equal(flow.flow_data.nodes[0].data.resolvedRequestIds, undefined);
  await registerGenerationAttempt(db, 'user', input);
  assert.equal(flow.updated_at, version);
});
test('registration rejects a stale competing attempt and an inaccessible flow before paid submission', async () => {
  const flow = flowRecord({ status: 'processing', generationRunId: 'first-run' });
  const input = { sourceType: 'canvas', sourceId: 'flow', nodeId: 'node', generationRunId: 'second-run', previousIdentity: 'old-run' };
  await assert.rejects(() => registerGenerationAttempt(database({ flows: [flow] }), 'user', input), /another tab/);
  await assert.rejects(() => registerGenerationAttempt(database({ flows: [flow] }), 'another-user', input), /Could not load/);
  assert.equal(flow.flow_data.nodes[0].data.generationRunId, 'first-run');
});
test('registration never recreates a deleted node', async () => {
  const flow = flowRecord(); flow.flow_data.nodes = [];
  await assert.rejects(() => registerGenerationAttempt(database({ flows: [flow] }), 'user', {
    sourceType: 'canvas', sourceId: 'flow', nodeId: 'node', generationRunId: 'new-run', previousIdentity: '',
  }), /removed or has not been saved/);
  assert.deepEqual(flow.flow_data.nodes, []);
});

test('registration resets old failed image slots and preserves the exact submitted batch size', async () => {
  const flow = flowRecord({ status: 'error', generationRunId: 'old', numImages: 4,
    generationSlots: ['old.png', null], generatedImages: ['old.png'], generationErrors: [null, { message: 'Old failure' }] });
  flow.flow_data.nodes[0].type = 'imageGenNode';
  await registerGenerationAttempt(database({ flows: [flow] }), 'user', {
    sourceType: 'canvas', sourceId: 'flow', nodeId: 'node', generationRunId: 'new', previousIdentity: 'old', generationSlotCount: 2,
  });
  assert.deepEqual(flow.flow_data.nodes[0].data.generationSlots, [null, null]);
  assert.deepEqual(flow.flow_data.nodes[0].data.generatedImages, []);
  assert.equal(flow.flow_data.nodes[0].data.generationErrors, undefined);
});
test('the complete exact batch is recovered even when no callbacks reached the browser', async () => {
  const flow = flowRecord({ status: 'processing', generationRunId: 'run', numImages: 2, generationSlots: [null, null] });
  flow.flow_data.nodes[0].type = 'imageGenNode';
  const generations = ['completed', 'failed'].map((status, slotIndex) => row({
    source_type: 'canvas', source_id: 'flow', node_id: 'node', model: 'model', media_type: 'image',
    fal_request_id: `request-${slotIndex}`, status, media_url: status === 'completed' ? 'gcs:good.png' : '',
    parameters: { endpoint: 'fal-ai/image', generationRunId: 'run', slotIndex },
  }));
  const result = await (await pendingRoute(database({ flows: [flow], generations })).GET()).json();
  assert.deepEqual(result.generations.map(g => g.status), ['completed', 'failed']);
  const h = harness(null); h.flowState().setCurrentFlow(flow);
  const saves = [];
  globalThis.fetch = async (url, options) => options?.method === 'PATCH'
    ? (saves.push(JSON.parse(options.body)), json({ ok: true })) : json(result);
  await h.recoverBackgroundGenerations();
  assert.deepEqual(h.state().jobs, {});
  assert.equal(saves[0].data.status, 'error');
  assert.deepEqual(saves[0].data.generatedImages, ['gcs:good.png']);
});
test('recovered media, partial slots, and upstream references receive usable signed URLs', async () => {
  const { signFlowMedia } = load('src/lib/flowMedia.ts', {
    '@/lib/gcs': { isGcsRef: value => value.startsWith('gcs:'), signGcsRef: async ref => `https://media.example/${ref.slice(4)}`,
      getSignedReadUrl: async path => `https://media.example/${path}` },
  });
  const signed = await signFlowMedia({ mediaUrl: 'gcs:result.mp4', nodeData: {
    generationSlots: ['gcs:first.png', null], inputImageUrls: ['gcs:input.png'], generationHistory: [['gcs:old.png']],
  } });
  assert.equal(signed.mediaUrl, 'https://media.example/result.mp4');
  assert.deepEqual(signed.nodeData.generationSlots, ['https://media.example/first.png', null]);
  assert.deepEqual(signed.nodeData.inputImageUrls, ['https://media.example/input.png']);
  assert.deepEqual(signed.nodeData.generationHistory, [['https://media.example/old.png']]);
});

test('a newer durable attempt clears the older tracker before its request IDs autosave', async () => {
  const flow = flowRecord({ status: 'processing', generationRunId: 'new-run' });
  const response = await pendingRoute(database({ flows: [flow], generations: [] })).POST({ json: async () => ({ jobs: [
    { id: 'flow:node', flowId: 'flow', nodeId: 'node', runId: 'old-run', previousIdentity: '', requestIds: ['old-request'] },
  ] }) });
  assert.deepEqual((await response.json()).removedJobIds, ['flow:node']);
});
test('recovery adds delayed database rows only to the same exact batch', async () => {
  const h = harness(job({ runId: 'run', nodeType: 'imageGenNode', kind: 'image-generation',
    slotCount: 2, slots: [null, null], requests: [{ ...job().requests[0], mediaType: 'image' }] }));
  const nodeData = { status: 'processing', generationRunId: 'run', numImages: 2, generationSlots: [null, null] };
  globalThis.fetch = async () => json({ generations: [0, 1].map(slotIndex => recovered({
    runId: 'run', nodeType: 'imageGenNode', mediaType: 'image', nodeData, slotIndex,
    requestId: slotIndex ? 'delayed-request' : 'request', status: 'processing',
  })) });
  await h.recoverBackgroundGenerations();
  assert.deepEqual(h.state().jobs['flow:node'].requests.map(r => r.requestId), ['request', 'delayed-request']);
  assert.deepEqual(h.state().jobs['flow:node'].failedSlots, []);
});
