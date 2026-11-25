import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

const require = createRequire(import.meta.url);
function load(path, dependencies = {}) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const loadedModule = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(name => dependencies[name] ?? require(name), loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
const music = load('src/lib/api/music.ts');
const body = (model = 'elevenlabs-music', changes = {}) => ({ model, prompt: 'Warm acoustic guitar', duration: 30,
  generationSlotCount: 2, slotIndex: 0, lyrics: '[verse]\nWarm sunshine', ...changes });

test('ElevenLabs sends milliseconds and every documented format without unsupported batching fields', () => {
  const config = music.MUSIC_MODELS[0];
  assert.equal(config.formats.length, 19);
  for (const outputFormat of config.formats) {
    const result = music.buildMusicInput(body(config.id, { duration: 600, outputFormat }));
    assert.equal(result.model.endpoint, 'fal-ai/elevenlabs/music');
    assert.deepEqual(result.input, { prompt: 'Warm acoustic guitar', music_length_ms: 600000, output_format: outputFormat });
  }
});
test('Sonilo sends seconds and one sample per recoverable slot, with fixed AAC output', () => {
  const result = music.buildMusicInput(body('sonilo-v1-1', { duration: 90, generationSlotCount: 3 }));
  assert.equal(result.model.endpoint, 'sonilo/v1.1/text-to-music');
  assert.equal(result.outputFormat, 'm4a');
  assert.deepEqual(result.input, { prompt: 'Warm acoustic guitar', duration: 90, num_samples: 1 });
  assert.throws(() => music.buildMusicInput(body('sonilo-v1-1', { outputFormat: 'mp3_44100_128' })), /format/);
});
test('Validation rejects invalid lengths, prompts, formats and batch slots before paid calls', () => {
  for (const model of music.MUSIC_MODELS) {
    for (const duration of music.musicLengthOptions(model.id)) {
      assert.doesNotThrow(() => music.buildMusicInput(body(model.id, { duration })));
    }
    for (const duration of model.durationMode === 'prompt' ? [] : [model.minDuration - 1, model.maxDuration + 1, 1.5, '30', NaN, Infinity, null]) {
      assert.throws(() => music.buildMusicInput(body(model.id, { duration })), /Length/);
    }
    for (const generationSlotCount of [0, model.maxBatchSize + 1, 1.5, '2']) {
      assert.throws(() => music.buildMusicInput(body(model.id, { generationSlotCount })), /batch/);
    }
    for (const slotIndex of [-1, 2, 0.5, '0']) assert.throws(() => music.buildMusicInput(body(model.id, { slotIndex })), /slot/);
    assert.throws(() => music.buildMusicInput(body(model.id, { prompt: ' ' })), /Describe/);
    assert.throws(() => music.buildMusicInput(body(model.id, { outputFormat: 'not-a-format' })), /format/);
  }
  assert.throws(() => music.buildMusicInput(body('elevenlabs-music', { prompt: 'a'.repeat(4101) })), /4100/);
  assert.throws(() => music.buildMusicInput(body('unknown')), /Unknown/);
});
test('Estimates apply billing rounding per track and multiply by batch count', () => {
  for (const [model, duration, count, expected] of [
    ['elevenlabs-music', 3, 1, 0.6], ['elevenlabs-music', 60, 2, 1.2],
    ['elevenlabs-music', 61, 4, 4.8], ['elevenlabs-music', 600, 4, 24],
    ['sonilo-v1-1', 1, 3, 0.075], ['sonilo-v1-1', 10, 1, 0.025],
    ['lyria-3-5', 60, 4, 0.4], ['minimax-music-3', 300, 3, 1.8], ['stable-audio-2-5', 190, 4, 0.8],
    ['sonilo-v1-1', 90, 3, 0.675], ['sonilo-v1-1', 600, 3, 4.5],
  ]) assert.ok(Math.abs(music.estimateMusicCost(model, duration, count) - expected) < 0.000001);
});
test('Audio formats have correct download types and raw audio detection survives URL signing', () => {
  assert.deepEqual(music.musicFileType('m4a'), { extension: 'm4a', contentType: 'audio/mp4' });
  assert.equal(music.musicFileType('mp3_44100_128').extension, 'mp3');
  assert.equal(music.musicFileType('opus_48000_128').contentType, 'audio/ogg');
  for (const format of ['pcm_44100', 'ulaw_8000', 'alaw_8000']) {
    assert.ok(music.isRawMusicUrl(`https://example.com/music.${music.musicFileType(format).extension}?token=abc`));
  }
  assert.equal(music.isRawMusicUrl('https://example.com/song.m4a?token=abc'), false);
});

function routeHarness({ user = { id: 'user' }, insertFails = false, flowError = false,
  session = { id: '00000000-0000-0000-0000-000000000001', user_id: 'user', kind: 'audio' }, sessionError = false } = {}) {
  const records = [], submissions = [], attempts = [];
  const db = { auth: { getUser: async () => ({ data: { user } }) }, from(table) {
    let matches = !!session;
    const q = { insert(value) { records.push(value); return Promise.resolve({ error: insertFails ? { message: 'audio migration missing' } : null }); },
      select() { return q; }, maybeSingle() { return q; }, update() { return q; },
      eq(key, value) { if (table === 'chat_sessions' && session?.[key] !== value) matches = false; return q; },
      then(resolve) { return Promise.resolve({ data: table === 'chat_sessions' && matches ? session : null,
        error: table === 'chat_sessions' && sessionError ? { message: 'Unavailable' } : null }).then(resolve); } };
    return q;
  } };
  const route = load('src/app/api/fal/music/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@fal-ai/client': { fal: { config() {}, queue: { submit: async (endpoint, options) => { submissions.push({ endpoint, ...options }); return { request_id: 'request' }; } } } },
    '@/lib/supabase/server': { createClient: async () => db }, '@/lib/api/music': music,
    '@/lib/falStorage': { getFalStorageHeaders: async () => { if (flowError) throw new Error('Flow not found'); return { 'X-Test': 'storage' }; } },
    '@/lib/generationAttempt': { registerGenerationAttempt: async (...args) => { attempts.push(args); } },
    '@/lib/flowClients': load('src/lib/flowClients.ts'), '@/lib/falErrors': { describeFalError: error => error.message },
  });
  const request = changes => ({ json: async () => ({ ...body(), sourceType: 'canvas', sourceId: '00000000-0000-0000-0000-000000000001',
    nodeId: 'node', generationRunId: '00000000-0000-0000-0000-000000000002', previousIdentity: '', ...changes }) });
  return { ...route, records, submissions, attempts, request };
}
test('Music route queues validated requests with storage policy and recovery metadata', async () => {
  const h = routeHarness();
  const response = await h.POST(h.request({}));
  assert.equal(response.status, 200);
  assert.equal(h.submissions[0].headers['X-Test'], 'storage');
  assert.equal(h.records[0].media_type, 'audio');
  assert.equal(h.records[0].parameters.slotIndex, 0);
  assert.equal(h.records[0].duration_seconds, 30);
  assert.equal(h.attempts.length, 1);
  assert.deepEqual((await response.json()).requests[0], { requestId: 'request', endpoint: 'fal-ai/elevenlabs/music', generationId: h.records[0].id });
});
test('Unauthorized, invalid, unowned and unsavable requests never reach fal', async () => {
  for (const [options, changes, status] of [[{ user: null }, {}, 401], [{}, { duration: 601 }, 400],
    [{}, { outputFormat: 'wav' }, 400], [{}, { sourceType: 'invalid' }, 400],
    [{ flowError: true }, {}, 500], [{ insertFails: true }, {}, 500]]) {
    const h = routeHarness(options);
    assert.equal((await h.POST(h.request(changes))).status, status);
    assert.equal(h.submissions.length, 0);
  }
});
test('Recording sessions use all music models without requiring a canvas node', async () => {
  for (const model of music.MUSIC_MODELS) {
    const h = routeHarness();
    const response = await h.POST(h.request({ sourceType: 'chat', model: model.id, lyrics: '[verse]\nWarm sunshine', nodeId: undefined, previousIdentity: undefined }));
    assert.equal(response.status, 200);
    assert.equal(h.records[0].source_type, 'chat');
    assert.equal(h.records[0].node_id, null);
    assert.equal(h.records[0].source_id, '00000000-0000-0000-0000-000000000001');
    assert.equal(h.submissions[0].endpoint, model.endpoint);
  }
});
test('Chat audio rejects missing, foreign and image/video sessions before paid work', async () => {
  for (const [options, changes, status] of [
    [{ session: null }, {}, 404],
    [{ session: { id: '00000000-0000-0000-0000-000000000001', user_id: 'someone-else', kind: 'audio' } }, {}, 404],
    [{ session: { id: '00000000-0000-0000-0000-000000000001', user_id: 'user', kind: 'image-video' } }, {}, 404],
    [{ sessionError: true }, {}, 503], [{}, { sourceId: undefined }, 400], [{}, { generationRunId: undefined }, 400],
  ]) {
    const h = routeHarness(options);
    assert.equal((await h.POST(h.request({ sourceType: 'chat', ...changes }))).status, status);
    assert.equal(h.records.length, 0);
    assert.equal(h.submissions.length, 0);
  }
});
test('Recording-session migration preserves existing sessions and separates new audio sessions', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE public.chat_sessions (id text, user_id text, title text, updated_at timestamptz);
      INSERT INTO public.chat_sessions (id, title) VALUES ('existing', 'Old session');`);
    const migration = readFileSync(new URL('../supabase/migrations/019_recording_sessions.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    await db.exec("INSERT INTO public.chat_sessions (id, kind) VALUES ('recording', 'audio')");
    assert.deepEqual((await db.query('SELECT id, kind FROM public.chat_sessions ORDER BY id')).rows,
      [{ id: 'existing', kind: 'image-video' }, { id: 'recording', kind: 'audio' }]);
    await assert.rejects(db.exec("INSERT INTO public.chat_sessions (kind) VALUES ('invalid')"), /check constraint/);
  } finally { await db.close(); }
});
test('Audio migration preserves image/video/prompt records and validates new media types', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE public.generations (media_type text CHECK (media_type IN ('image', 'video', 'prompt')));
      INSERT INTO public.generations VALUES ('image'), ('video'), ('prompt');`);
    const migration = readFileSync(new URL('../supabase/migrations/018_audio_generations.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    await db.exec("INSERT INTO public.generations VALUES ('audio')");
    assert.equal((await db.query('SELECT * FROM public.generations')).rows.length, 4);
    await assert.rejects(db.exec("INSERT INTO public.generations VALUES ('invalid')"), /check constraint/);
  } finally { await db.close(); }
});

function audioStatusHarness(format, { result = { audio: { url: 'https://media.example/music' } }, owner = 'user', storageFails = false } = {}) {
  const row = { id: 'generation', user_id: owner, media_type: 'audio', status: 'processing', media_url: '',
    parameters: { endpoint: 'fal-ai/elevenlabs/music', outputFormat: format }, created_at: new Date().toISOString() };
  const uploads = [], polls = [], billings = [];
  const db = { auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) }, from() {
    let updates, allowed = true;
    const q = { select() { return q; }, eq(key, value) { if (key === 'user_id' && row.user_id !== value) allowed = false; return q; },
      update(value) { updates = value; return q; }, maybeSingle() { return q; },
      then(resolve) { if (allowed && updates) Object.assign(row, updates); return Promise.resolve({ data: allowed ? row : null, error: null }).then(resolve); } };
    return q;
  } };
  const route = load('src/app/api/fal/status/[requestId]/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/supabase/server': { createClient: async () => db },
    '@fal-ai/client': { ApiError: class extends Error {}, fal: { config() {}, queue: { status: async endpoint => {
      polls.push(endpoint); return { status: 'COMPLETED', response_url: 'https://queue.fal.run/result' };
    } } } },
    '@/lib/api/music': music,
    '@/lib/gcs': { isGcsRef: url => url.startsWith('gcs:'), signGcsRef: async ref => `https://storage.example/${ref.slice(4)}`,
      getSignedReadUrl: async path => `https://storage.example/${path}`,
      uploadToGCS: async (bytes, path, contentType) => {
        if (storageFails) throw new Error('Storage unavailable');
        uploads.push({ bytes: new Uint8Array(bytes), path, contentType }); return `gcs:${path}`;
      } },
    '@/lib/mediaDerivatives': {}, '@/lib/falErrors': { describeFalError: error => error.message, isTerminalFalError: () => false },
    '@/lib/generationFailures': { failGeneration: async (_db, _user, _request, error) => Response.json({ status: 'failed', error }) },
    '@/lib/falRecovery': {}, '@/lib/seedanceDraft': {},
    '@/lib/falResult': { fetchFalQueueResult: async () => ({ data: result, billableUnits: 2 }),
      getFalBillingColumns: async (endpoint, units) => { billings.push([endpoint, units]); return { fal_cost_usd: 1.2 }; },
      mergeFalBillingParameters: (parameters, billing) => ({ ...parameters, falBilling: billing }),
      persistFalBillingBestEffort: async (billing, persist) => persist(billing),
    },
  });
  return { row, uploads, polls, billings, get: () => route.GET({ nextUrl: new URL('https://app.example/api/fal/status/request?mediaType=audio&endpoint=untrusted') },
    { params: Promise.resolve({ requestId: 'request' }) }) };
}

test('Completion stores original audio bytes, correct extensions, signed URLs and measured billing; repeat polls are idempotent', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]));
  try {
    for (const [format, extension, contentType] of [['mp3_44100_128', 'mp3', 'audio/mpeg'], ['m4a', 'm4a', 'audio/mp4'],
      ['wav', 'wav', 'audio/wav'], ['mp3', 'mp3', 'audio/mpeg'], ['opus_48000_128', 'opus', 'audio/ogg'], ['pcm_44100', 'pcm', 'audio/pcm'], ['ulaw_8000', 'ulaw', 'audio/basic'], ['alaw_8000', 'alaw', 'audio/x-alaw']]) {
      const h = audioStatusHarness(format, format === 'm4a' ? { result: { audios: [{ url: 'https://media.example/song.m4a' }] } } : {});
      const response = await h.get();
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).mediaUrls, [`https://storage.example/user/generation.${extension}`]);
      assert.deepEqual(h.uploads[0].bytes, new Uint8Array([1, 2, 3]));
      assert.equal(h.uploads[0].contentType, contentType);
      assert.equal(h.row.status, 'completed');
      assert.equal(h.row.fal_cost_usd, 1.2);
      assert.deepEqual(h.billings, [['fal-ai/elevenlabs/music', 2]]);
      await h.get();
      assert.equal(h.uploads.length, 1);
      assert.equal(h.polls.length, 1);
    }
  } finally { globalThis.fetch = originalFetch; }
});
test('Audio status denies unowned requests and does not report success when media is missing or storage fails', async () => {
  const denied = audioStatusHarness('m4a', { owner: 'other-user' });
  assert.equal((await denied.get()).status, 404);
  assert.equal(denied.polls.length, 0);
  const empty = audioStatusHarness('m4a', { result: {} });
  assert.equal((await (await empty.get()).json()).status, 'failed');
  assert.equal(empty.uploads.length, 0);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array([1]));
  try {
    const h = audioStatusHarness('m4a', { storageFails: true });
    assert.equal((await h.get()).status, 500);
    assert.equal(h.row.status, 'processing');
  } finally { globalThis.fetch = originalFetch; }
});


test('Lyria uses only a prompt, validates 5000 characters, and does not claim an exact duration', () => {
  const result = music.buildMusicInput(body('lyria-3-5', { duration: undefined }));
  assert.equal(result.model.endpoint, 'google/lyria-3.5');
  assert.deepEqual(result.input, { prompt: 'Warm acoustic guitar' });
  assert.equal(result.duration, null);
  assert.equal(result.outputFormat, 'mp3');
  assert.deepEqual(music.musicLengthOptions('lyria-3-5'), []);
  assert.throws(() => music.buildMusicInput(body('lyria-3-5', { prompt: 'a'.repeat(5001) })), /5000/);
});

test('MiniMax preserves lyrics after section tags and Stable Audio uses seconds_total', () => {
  const minimax = music.buildMusicInput(body('minimax-music-3', { duration: 300, lyrics: '[verse] Warm sunshine\n[chorus]\nBlue skies' }));
  assert.equal(minimax.model.endpoint, 'minimax/music-3');
  assert.deepEqual(minimax.input, { prompt: 'Warm acoustic guitar', duration: 300, lyrics: '[verse]\nWarm sunshine\n[chorus]\nBlue skies' });
  assert.equal(minimax.outputFormat, 'wav');
  assert.throws(() => music.buildMusicInput(body('minimax-music-3', { lyrics: ' ' })), /lyrics/);
  assert.throws(() => music.buildMusicInput(body('minimax-music-3', { lyrics: undefined })), /lyrics/);
  const stable = music.buildMusicInput(body('stable-audio-2-5', { duration: 190 }));
  assert.equal(stable.model.endpoint, 'fal-ai/stable-audio-25/text-to-audio');
  assert.deepEqual(stable.input, { prompt: 'Warm acoustic guitar', seconds_total: 190 });
  assert.equal(stable.outputFormat, 'wav');
  assert.ok(music.musicLengthOptions('stable-audio-2-5').includes(190));
  assert.ok(!music.musicLengthOptions('stable-audio-2-5').includes(240));
});

test('New models submit correct payloads from both canvas and recording sessions', async () => {
  for (const sourceType of ['canvas', 'chat']) {
    for (const model of ['lyria-3-5', 'minimax-music-3', 'stable-audio-2-5']) {
      const h = routeHarness();
      const response = await h.POST(h.request({ sourceType, model }));
      assert.equal(response.status, 200);
      assert.equal(h.submissions[0].endpoint, music.getMusicModel(model).endpoint);
      assert.equal(h.records[0].parameters.outputFormat, model === 'lyria-3-5' ? 'mp3' : 'wav');
      assert.equal(h.records[0].duration_seconds, model === 'lyria-3-5' ? null : 30);
      if (model === 'minimax-music-3') assert.equal(h.records[0].parameters.lyrics, '[verse]\nWarm sunshine');
    }
  }
  const h = routeHarness();
  assert.equal((await h.POST(h.request({ model: 'minimax-music-3', lyrics: '' }))).status, 400);
  assert.equal(h.submissions.length, 0);
});

test('Stable Audio string results and MiniMax actual duration are saved as WAV', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array([82, 73, 70, 70]));
  try {
    for (const result of [{ audio: 'https://media.example/audio.wav' }, { audio: { url: 'https://media.example/audio.wav' }, duration: 42 }]) {
      const h = audioStatusHarness('wav', { result });
      assert.equal((await h.get()).status, 200);
      assert.equal(h.uploads[0].contentType, 'audio/wav');
      assert.equal(h.uploads[0].path, 'user/generation.wav');
      if (result.duration) assert.equal(h.row.duration_seconds, 42);
    }
  } finally { globalThis.fetch = originalFetch; }
});
