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
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(name => dependencies[name] ?? require(name), loaded, loaded.exports);
  return loaded.exports;
}
const media = load('src/lib/utils/mediaUtils.ts');
const { findCanvasGeneration } = load('src/lib/canvasGeneration.ts', { '@/lib/utils/mediaUtils': media });
const signed = (path, signature = 'old') => `https://storage.googleapis.com/within-glide/${path}?X-Goog-Signature=${signature}`;
const generation = (id, url, extra = {}) => ({
  id, media_url: url, user_id: 'owner', status: 'completed', media_type: 'image',
  model: `model-${id}`, prompt: `prompt-${id}`, fal_cost_usd: 0.2, width: 2880, height: 2880,
  created_at: '2026-11-13T12:00:00Z', ...extra,
});

function likeRegex(pattern) {
  let regex = '^';
  for (let i = 0; i < pattern.length; i++) {
    let char = pattern[i];
    if (char === '%') { regex += '.*'; continue; }
    if (char === '_') { regex += '.'; continue; }
    if (char === '\\') char = pattern[++i];
    regex += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(regex + '$');
}

function database(rows, { signedIn = true, error = null } = {}) {
  const queries = [];
  return {
    queries,
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: 'owner' } : null } }) },
    from(table) {
      assert.equal(table, 'generations');
      const filters = [];
      const query = { filters };
      queries.push(query);
      return {
        select() { return this; },
        eq(key, value) { filters.push(row => row[key] === value); return this; },
        neq(key, value) { filters.push(row => row[key] !== value); return this; },
        in(key, values) { filters.push(row => values.includes(row[key])); return this; },
        like(key, pattern) { query.pattern = pattern; filters.push(row => likeRegex(pattern).test(row[key])); return this; },
        order() { return this; }, limit() { return this; },
        abortSignal(signal) { query.signal = signal; return this; },
        async maybeSingle() { return { data: rows.find(row => filters.every(filter => filter(row))) ?? null, error }; },
      };
    },
  };
}
const signal = () => new AbortController().signal;

test('each batch/history image and video resolves its own saved metadata', async () => {
  const rows = [
    generation('old-image', 'gcs:images/old.png'),
    generation('batch-1', 'gcs:images/one.png'),
    generation('batch-2', 'gcs:images/two.png', { fal_cost_usd: 0.5 }),
    generation('old-video', 'gcs:videos/old.mp4', { media_type: 'video' }),
  ];
  for (const row of rows) {
    const db = database(rows);
    assert.deepEqual(await findCanvasGeneration(db, signed(row.media_url.slice(4), 'refreshed'), signal()), row);
    assert.equal(db.queries.length, 1);
  }
});

test('legacy signed URLs match across refreshed signatures, encoded paths and host styles', async () => {
  for (const url of [signed('images/with%20space.png'), signed('images/with space.png'), 'https://within-glide.storage.googleapis.com/images/with%20space.png?X-Goog-Signature=old']) {
    const row = generation('legacy', url);
    assert.deepEqual(await findCanvasGeneration(database([row]), 'gcs:images/with space.png', signal()), row);
  }
});

test('legacy lookup escapes SQL wildcards and matches the exact media object', async () => {
  const wrong = generation('wrong', signed('images/aXb.png'));
  const correct = generation('correct', signed('images/a_b.png'));
  assert.deepEqual(await findCanvasGeneration(database([wrong, correct]), 'gcs:images/a_b.png', signal()), correct);
  assert.equal(await findCanvasGeneration(database([generation('wrong', signed('images/a_b.png.extra'))]), 'gcs:images/a_b.png', signal()), null);
});

test('unrelated, deleted, incomplete and other users’ media never gets substituted', async () => {
  const url = 'gcs:images/output.png';
  const db = database([
    generation('other-owner', url, { user_id: 'someone-else' }),
    generation('pending', url, { status: 'processing' }),
    generation('unrelated', 'gcs:images/other.png'),
  ]);
  assert.equal(await findCanvasGeneration(db, url, signal()), null);
  assert.equal(await findCanvasGeneration(database([]), 'https://example.com/upload.png', signal()), null);
});

test('external URLs use an exact match and preserve their query string', async () => {
  const row = generation('external', 'https://example.com/result.png?version=2');
  const db = database([row]);
  assert.deepEqual(await findCanvasGeneration(db, row.media_url, signal()), row);
  assert.equal(db.queries.length, 1);
});

test('authentication and query failures are surfaced, with cancellation passed through', async () => {
  await assert.rejects(findCanvasGeneration(database([], { signedIn: false }), 'gcs:a.png', signal()), /Sign in/);
  await assert.rejects(findCanvasGeneration(database([], { error: new Error('offline') }), 'gcs:a.png', signal()), /offline/);
  const db = database([]);
  const requestSignal = signal();
  await findCanvasGeneration(db, 'gcs:a.png', requestSignal);
  assert.ok(db.queries.every(query => query.signal === requestSignal));
});
