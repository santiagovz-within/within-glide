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
  new Function('require', 'module', 'exports', outputText)(
    name => name in dependencies ? dependencies[name] : require(name), loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
const helpers = load('src/lib/adminUserStats.ts');
const { getAdminUserStats } = load('src/app/api/admin/users/stats/summary.ts', { '@/lib/adminUserStats': helpers });
const now = new Date('2026-01-01T15:00:00Z');
function database(tables = {}, { rowLimit = 1000, failureTable } = {}) {
  return { from(table) {
    const predicates = [];
    const orders = [];
    let start = 0, end = Infinity, head = false;
    const query = {
      select(_columns, options) { head = options?.head; return query; },
      eq(key, value) { predicates.push(row => row[key] === value); return query; },
      in(key, values) { predicates.push(row => values.includes(row[key])); return query; },
      gte(key, value) { predicates.push(row => row[key] >= value); return query; },
      lt(key, value) { predicates.push(row => row[key] < value); return query; },
      order(key) { orders.push(key); return query; },
      range(from, to) { start = from; end = to; return query; },
      then(resolve, reject) {
        if (table === failureTable) return Promise.resolve({ data: null, error: new Error('Database unavailable') }).then(resolve, reject);
        const rows = (tables[table] ?? []).filter(row => predicates.every(p => p(row)))
          .sort((a, b) => orders.reduce((result, key) => result || String(a[key]).localeCompare(String(b[key])), 0));
        return Promise.resolve({ count: head ? rows.length : null, error: null,
          data: head ? null : rows.slice(start, Math.min(end + 1, start + rowLimit)),
        }).then(resolve, reject);
      },
    };
    return query;
  } };
}
const generation = (id, user_id, media_type = 'image', status = 'completed', created_at = '2025-12-02T12:00:00.000Z') =>
  ({ id, user_id, media_type, status, created_at });

test('Window covers exactly 30 complete UTC days across years and leap days', () => {
  assert.deepEqual(helpers.userStatsWindow(now), { days: 30, start: '2025-12-02T00:00:00.000Z', end: '2026-01-01T00:00:00.000Z' });
  const leap = helpers.userStatsWindow(new Date('2024-03-01T05:59:00+06:00'));
  assert.equal(leap.end, '2024-02-29T00:00:00.000Z');
  assert.equal(Date.parse(leap.end) - Date.parse(leap.start), 30 * 86400000);
});

test('Counts approved accounts exactly and unique activity per day, including zero-activity days', async () => {
  const stats = await getAdminUserStats(database({
    profiles: [{ approved: true }, { approved: false }, { approved: true }, { approved: null }],
    generations: [generation('1', 'a'), generation('2', 'a', 'video'), generation('3', 'b', 'image', 'failed'),
      generation('4', 'a', 'image', 'processing', '2025-12-03T00:00:00.000Z'),
      generation('5', 'c', 'prompt'),
      generation('6', 'd', 'image', 'completed', '2026-01-01T00:00:00.000Z'),
      generation('7', 'e', 'image', 'completed', '2025-12-01T23:59:59.999Z')],
  }), now);
  assert.equal(stats.approvedUsers, 2);
  assert.equal(stats.averageDailyActiveUsers, 3 / 30);
  assert.equal(stats.averageDailyImages, 1 / 30);
  assert.equal(stats.averageDailyVideos, 1 / 30);
});

test('Reads all pages even when the server applies a lower row limit', async () => {
  const stats = await getAdminUserStats(database({
    profiles: Array.from({ length: 125 }, () => ({ approved: true })),
    generations: Array.from({ length: 2401 }, (_, i) => generation(String(i).padStart(5, '0'), 'same-user')),
  }, { rowLimit: 7 }), now);
  assert.equal(stats.approvedUsers, 125);
  assert.equal(stats.averageDailyImages, 2401 / 30);
  assert.equal(stats.averageDailyActiveUsers, 1 / 30);
});

test('Empty data yields zero and database failures never masquerade as zero', async () => {
  const stats = await getAdminUserStats(database(), now);
  for (const key of ['approvedUsers', 'averageDailyActiveUsers', 'averageDailyImages', 'averageDailyVideos']) assert.equal(stats[key], 0);
  for (const failureTable of ['profiles', 'generations']) {
    await assert.rejects(getAdminUserStats(database({}, { failureTable }), now), /Database unavailable/);
  }
});

function route({ signedIn = true, admin = true, fail = false } = {}) {
  const calls = { privileged: 0 };
  const apiModule = load('src/app/api/admin/users/stats/route.ts', {
    '@/lib/supabase/server': {
      createClient: async () => ({ auth: { getUser: async () => ({ data: { user: signedIn ? { id: 'admin' } : null } }) },
        from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { is_admin: admin } }) }) }) }) }),
      createAdminClient: () => { calls.privileged++; return {}; },
    },
    './summary': { getAdminUserStats: async () => {
      if (fail) throw new Error('Database unavailable');
      return { approvedUsers: 125 };
    } },
  });
  return { ...apiModule, calls };
}

test('Endpoint rejects non-admins before creating a privileged client', async () => {
  for (const options of [{ signedIn: false }, { admin: false }]) {
    const api = route(options);
    assert.equal((await api.GET()).status, 403);
    assert.equal(api.calls.privileged, 0);
  }
  const api = route();
  const response = await api.GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { approvedUsers: 125 });
});

test('Endpoint reports statistics failures without returning misleading zero counts', async (t) => {
  t.mock.method(console, 'error', () => {});
  const response = await route({ fail: true }).GET();
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.approvedUsers, undefined);
  assert.match(body.error, /Unable to load user statistics/);
});
