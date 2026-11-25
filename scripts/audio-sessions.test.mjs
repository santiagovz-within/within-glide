import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';

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
const session = (id, kind = 'audio') => ({ id, user_id: 'user', kind, title: 'New recording session', updated_at: new Date().toISOString() });

function harness() {
  const store = load('src/lib/stores/audioStore.ts', { '@/lib/api/music': music });
  const gallery = load('src/lib/stores/galleryStore.ts');
  const rows = { chat_sessions: [session('one'), session('two'), session('visual', 'image-video')], generations: [] };
  const queries = [];
  const db = { auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) }, from(table) {
    const filters = [];
    let action, value, single = false;
    const query = {
      select() { return query; }, order() { return query; },
      eq(key, target) { filters.push(row => row[key] === target); return query; },
      in(key, targets) { filters.push(row => targets.includes(row[key])); return query; },
      insert(data) { action = 'insert'; value = data; return query; },
      update(data) { action = 'update'; value = data; return query; },
      single() { single = true; return query; },
      then(resolve) {
        queries.push(table);
        let selected = rows[table].filter(row => filters.every(filter => filter(row)));
        if (action === 'insert') { selected = [{ id: crypto.randomUUID(), ...value }]; rows[table].push(...selected); }
        if (action === 'update') selected.forEach(row => Object.assign(row, value));
        return Promise.resolve({ data: structuredClone(single ? selected[0] : selected), error: null }).then(resolve);
      },
    };
    return query;
  } };
  const api = load('src/lib/audioGeneration.ts', { '@/lib/supabase/client': { createClient: () => db },
    '@/lib/stores/audioStore': store, '@/lib/stores/galleryStore': gallery, '@/lib/api/music': music });
  store.useAudioStore.getState().setSessions(rows.chat_sessions.filter(row => row.kind === 'audio'));
  return { ...store, ...gallery, ...api, rows, queries };
}

function recording(id, changes = {}) {
  return { id, user_id: 'user', media_type: 'audio', source_type: 'chat', source_id: 'one', status: 'processing',
    fal_request_id: `request-${id}`, media_url: '', created_at: new Date().toISOString(), ...changes };
}

test('Recording history only loads audio from the selected recording session', async () => {
  const h = harness();
  h.rows.generations.push(recording('audio'), recording('other', { source_id: 'two' }), recording('image', { media_type: 'image' }),
    recording('canvas', { source_type: 'canvas' }));
  assert.deepEqual((await h.loadRecordingSessions()).map(item => item.id), ['one', 'two']);
  await h.loadRecordingGenerations('one');
  assert.deepEqual(Object.keys(h.useAudioStore.getState().generations), ['audio']);
});

test('Switching models clamps batch counts, resets formats and keeps supported lengths', () => {
  const h = harness();
  h.useAudioStore.getState().updateSettings({ numSounds: 4, duration: 120, outputFormat: 'pcm_48000' });
  h.useAudioStore.getState().setModel('sonilo-v1-1');
  assert.deepEqual(h.useAudioStore.getState().settings, { model: 'sonilo-v1-1', numSounds: 3, duration: 120, outputFormat: 'm4a' });
  h.useAudioStore.getState().updateSettings({ duration: 1 });
  h.useAudioStore.getState().setModel('elevenlabs-music');
  assert.equal(h.useAudioStore.getState().settings.duration, 30);
  assert.equal(h.useAudioStore.getState().settings.outputFormat, 'mp3_44100_128');
});

test('Batch submissions retain their original session and settings, and preserve partial successes', async () => {
  const h = harness();
  const originalFetch = globalThis.fetch;
  const requests = [];
  h.useAudioStore.getState().setPrompt('Warm piano');
  h.useAudioStore.getState().updateSettings({ numSounds: 3 });
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    if (body.slotIndex === 0) {
      h.useAudioStore.getState().setActiveSessionId('two');
      h.useAudioStore.getState().setPrompt('Changed after submission');
      h.useAudioStore.getState().setModel('sonilo-v1-1');
      await h.generateRecordingBatch(); // A second click while submitting must not duplicate paid work.
    }
    if (body.slotIndex === 1) return Response.json({ error: 'Provider unavailable' }, { status: 503 });
    const row = recording(`slot-${body.slotIndex}`, { source_id: body.sourceId });
    h.rows.generations.push(row);
    return Response.json({ requests: [{ generationId: row.id }] });
  };
  try {
    await h.generateRecordingBatch();
    assert.equal(requests.length, 3);
    assert.ok(requests.every(request => request.sourceId === 'one' && request.prompt === 'Warm piano' && request.model === 'elevenlabs-music'));
    assert.equal(new Set(requests.map(request => request.generationRunId)).size, 1);
    assert.deepEqual(requests.map(request => request.slotIndex), [0, 1, 2]);
    assert.equal(Object.keys(h.useAudioStore.getState().generations).length, 2);
    assert.match(h.useAudioStore.getState().error, /Track 2: Provider unavailable/);
    assert.equal(h.useAudioStore.getState().isSubmitting, false);
    assert.equal(h.useAudioStore.getState().activeSessionId, 'two');
  } finally { globalThis.fetch = originalFetch; }
});

test('First generation creates an audio session, while invalid prompts never submit paid work', async () => {
  const h = harness();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  h.useAudioStore.getState().setSessions([]);
  h.useAudioStore.getState().setPrompt('a'.repeat(4101));
  globalThis.fetch = async (_url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    const row = recording('new', { source_id: body.sourceId });
    h.rows.generations.push(row);
    return Response.json({ requests: [{ generationId: row.id }] });
  };
  try {
    await h.generateRecordingBatch();
    assert.equal(calls, 0);
    assert.match(h.useAudioStore.getState().error, /4100/);
    h.useAudioStore.getState().setPrompt('Bright acoustic guitar');
    await h.generateRecordingBatch();
    assert.equal(calls, 1);
    assert.equal(h.useAudioStore.getState().sessions[0].kind, 'audio');
    assert.equal(h.useAudioStore.getState().sessions[0].title, 'Bright acoustic guitar');
  } finally { globalThis.fetch = originalFetch; }
});

test('Recovery resumes chat audio after reload and polling survives temporary errors without duplicate gallery entries', async () => {
  const h = harness();
  const row = recording('recover');
  h.rows.generations.push(row, recording('canvas', { source_type: 'canvas' }), recording('video', { media_type: 'video' }));
  await h.recoverAudioGenerations();
  assert.deepEqual(Object.keys(h.useAudioStore.getState().generations), ['recover']);
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ error: 'Temporary problem' }, { status: 503 });
    await h.pollAudioGeneration(row);
    assert.equal(h.useAudioStore.getState().generations.recover.status, 'processing');
    globalThis.fetch = async url => {
      assert.match(url, /mediaType=audio/);
      Object.assign(row, { status: 'completed', media_url: 'https://example.com/audio.mp3' });
      return Response.json({ status: 'completed', generationId: row.id });
    };
    await h.pollAudioGeneration(row);
    await h.pollAudioGeneration(row);
    assert.equal(h.useGalleryStore.getState().generations.length, 1);
    // A stale session load cannot turn the completed tile back into a spinner.
    h.useAudioStore.getState().mergeGenerations([recording('recover')]);
    assert.equal(h.useAudioStore.getState().generations.recover.status, 'completed');
  } finally { globalThis.fetch = originalFetch; }
});
