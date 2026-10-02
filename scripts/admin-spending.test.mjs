import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
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
const helpers = load('src/lib/adminSpending.ts');
const fixedNow = new Date('2026-01-01T00:30:00.000Z');
const { getUserSpending } = load('src/app/api/admin/usage/spending.ts', {
  '@/lib/adminSpending': { ...helpers, spendingWindow: (period, _now, selection) => helpers.spendingWindow(period, fixedNow, selection) },
});

function database(tables, { rowLimit = 1000, missingColumn = false, failureTable } = {}) {
  return { from(table) {
    let start = 0;
    let end = Infinity;
    let columns = '';
    const predicates = [];
    const orders = [];
    const query = {
      select(value) { columns = value; return query; },
      eq(key, value) { predicates.push(row => row[key] === value); return query; },
      gte(key, value) { predicates.push(row => row[key] >= value); return query; },
      lt(key, value) { predicates.push(row => row[key] < value); return query; },
      lte(key, value) { predicates.push(row => row[key] <= value); return query; },
      in(key, values) { predicates.push(row => values.includes(row[key])); return query; },
      order(key) { orders.push(key); return query; },
      range(from, to) { start = from; end = to; return query; },
      then(resolve, reject) {
        if (failureTable === table) return Promise.resolve({ data: null, error: { message: 'Database unavailable' } }).then(resolve, reject);
        if (missingColumn && columns.includes('fal_cost_usd')) {
          return Promise.resolve({ data: null, error: { code: '42703', message: 'column generations.fal_cost_usd does not exist' } }).then(resolve, reject);
        }
        const rows = (tables[table] ?? []).filter(row => predicates.every(predicate => predicate(row)))
          .sort((a, b) => {
            for (const key of orders) {
              const order = String(a[key]).localeCompare(String(b[key]));
              if (order) return order;
            }
            return 0;
          }).slice(start, Math.min(end + 1, start + rowLimit))
          .map(row => missingColumn ? { ...row, fal_cost_usd: undefined } : row);
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return query;
  } };
}

function generation(id, userId, cost, createdAt = '2026-01-01T00:00:00.000Z') {
  return { id, user_id: userId, fal_cost_usd: cost, status: 'completed', created_at: createdAt };
}

test('calendar windows use UTC and handle leap days and year boundaries', () => {
  assert.equal(helpers.spendingWindow('day', new Date('2024-02-29T23:59:00Z')).start, '2024-02-29T00:00:00.000Z');
  assert.equal(helpers.spendingWindow('month', new Date('2025-12-31T20:00:00-06:00')).start, '2026-01-01T00:00:00.000Z');
  assert.equal(helpers.spendingWindow('all', fixedNow).start, null);
  assert.equal(helpers.spendingWindow('day', fixedNow).end, fixedNow.toISOString());
});

test('billing fallback preserves zero, rejects invalid costs and never adds duplicate representations', () => {
  assert.equal(helpers.generationCost({ fal_cost_usd: '1.25', billing: { costUsd: 9 } }), 1.25);
  assert.equal(helpers.generationCost({ fal_cost_usd: 0, billing: { costUsd: 9 } }), 0);
  assert.equal(helpers.generationCost({ fal_cost_usd: null, billing: { costUsd: 0.005 } }), 0.005);
  for (const value of [null, undefined, '', ' ', -1, NaN, Infinity, {}, true]) {
    assert.equal(helpers.recordedCost(value), null);
  }
});

test('ranking combines sources, excludes unknown and failed costs, and respects period boundaries', async () => {
  const tables = {
    generations: [
      generation('1', 'alice', 2),
      generation('2', 'bob', null),
      { ...generation('3', 'alice', 100), status: 'failed' },
      generation('4', 'bob', 10, '2025-12-31T23:59:59.999Z'),
      generation('5', 'future', 100, '2026-01-01T01:00:00.000Z'),
      { ...generation('6', 'bob', null), billing: { costUsd: 1 } },
    ],
    realtime_usage: [
      { user_id: 'bob', cost_usd: '4', usage_date: '2026-01-01' },
      { user_id: 'realtime-only', cost_usd: 0.25, usage_date: '2026-01-01' },
      { user_id: 'alice', cost_usd: 50, usage_date: '2025-12-31' },
    ],
    profiles: [{ id: 'bob', display_name: 'Bob' }, { id: 'alice', username: 'Alice' }],
  };
  const day = await getUserSpending(database(tables), 'day');
  assert.deepEqual(day.users, [
    { userId: 'bob', username: 'Bob', costUsd: 5 },
    { userId: 'alice', username: 'Alice', costUsd: 2 },
    { userId: 'realtime-only', username: 'realtime', costUsd: 0.25 },
  ]);
  assert.equal(day.totalCostUsd, 7.25);
  assert.equal(day.unpricedGenerations, 1);
  const month = await getUserSpending(database(tables), 'month');
  assert.equal(month.totalCostUsd, 7.25);
  const all = await getUserSpending(database(tables), 'all');
  assert.equal(all.totalCostUsd, 67.25);
  assert.equal(all.users[0].userId, 'alice');
});

test('pagination includes history beyond the old 50k cap and smaller server page limits', async () => {
  const generations = Array.from({ length: 50001 }, (_, i) => generation(String(i).padStart(6, '0'), 'alice', 0.25));
  const result = await getUserSpending(database({ generations }, { rowLimit: 700 }), 'all');
  assert.equal(result.totalCostUsd, 12500.25);
});

test('legacy billing metadata works without the optional billing column', async () => {
  const result = await getUserSpending(database({ generations: [
    { ...generation('1', 'alice', null), billing: { costUsd: 3 } },
  ] }, { missingColumn: true }), 'day');
  assert.equal(result.totalCostUsd, 3);
});

test('empty data is zero, while database failures never return misleading partial totals', async () => {
  const result = await getUserSpending(database({}), 'all');
  assert.deepEqual(result.users, []);
  assert.equal(result.totalCostUsd, 0);
  for (const failureTable of ['generations', 'realtime_usage', 'profiles']) {
    await assert.rejects(getUserSpending(database({ generations: [generation('1', 'alice', 3)] }, { failureTable }), 'day'));
  }
});

test('spending requests retain admin authorization and validate period values', async () => {
  let isAdmin = false;
  let reads = 0;
  const { GET } = load('src/app/api/admin/usage/route.ts', {
    '@/lib/adminSpending': helpers,
    './spending': { getUserSpending: async (_client, period, selection) => { helpers.spendingWindow(period, fixedNow, selection); reads++; return { period, selection }; } },
    '@/lib/supabase/server': {
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) },
        from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { is_admin: isAdmin } }) }) }) }),
      }),
      createAdminClient: () => ({}),
    },
  });
  const request = (period, selection) => ({ nextUrl: new URL(`https://example.test/api/admin/usage?spendingPeriod=${period}${selection ? `&spendingDate=${selection}` : ''}`) });
  assert.equal((await GET(request('day'))).status, 403);
  assert.equal(reads, 0);
  isAdmin = true;
  assert.equal((await GET(request('week'))).status, 400);
  assert.equal(reads, 0);
  assert.equal((await GET(request('day', '2025-02-30'))).status, 400);
  assert.deepEqual(await (await GET(request('month', '2025-12'))).json(), { period: 'month', selection: '2025-12' });
  for (const period of helpers.SPENDING_PERIODS) {
    const response = await GET(request(period));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { period });
  }
});

test('specific dates, months and years have exclusive UTC end boundaries', () => {
  for (const [period, selection, start, end] of [
    ['day', '2025-12-31', '2025-12-31T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
    ['day', '2024-02-29', '2024-02-29T00:00:00.000Z', '2024-03-01T00:00:00.000Z'],
    ['month', '2024-02', '2024-02-01T00:00:00.000Z', '2024-03-01T00:00:00.000Z'],
    ['month', '2025-12', '2025-12-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
    ['year', '2024', '2024-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'],
  ]) {
    assert.deepEqual(helpers.spendingWindow(period, fixedNow, selection), { start, end });
  }
  assert.equal(helpers.spendingWindow('year', fixedNow, '2026').end, fixedNow.toISOString());
});

test('invalid, incomplete and future selections are rejected', () => {
  for (const [period, selection] of [
    ['day', '2025-02-29'], ['day', '2024-02-30'], ['day', '2025-13-01'],
    ['day', '2026-01-02'], ['day', '2025-1-1'], ['day', ''],
    ['month', '2026-02'], ['month', '2025-00'], ['month', '2025-13'],
    ['year', '2027'], ['year', '25'], ['year', '0000'], ['year', '-100'],
  ]) {
    assert.throws(() => helpers.spendingWindow(period, fixedNow, selection), helpers.InvalidSpendingSelection);
  }
});

test('historical rankings include the chosen period only for both cost sources', async () => {
  const tables = {
    generations: [
      generation('1', 'alice', 1, '2025-01-01T00:00:00.000Z'),
      generation('2', 'alice', 2, '2025-12-01T00:00:00.000Z'),
      generation('3', 'alice', 4, '2025-12-31T00:00:00.000Z'),
      generation('4', 'alice', 8, '2025-12-31T23:59:59.999Z'),
      generation('5', 'alice', 16, '2026-01-01T00:00:00.000Z'),
      generation('6', 'alice', 32, '2024-12-31T23:59:59.999Z'),
    ],
    realtime_usage: [
      { user_id: 'alice', cost_usd: 1, usage_date: '2025-01-01' },
      { user_id: 'alice', cost_usd: 2, usage_date: '2025-12-01' },
      { user_id: 'alice', cost_usd: 4, usage_date: '2025-12-31' },
      { user_id: 'alice', cost_usd: 8, usage_date: '2026-01-01' },
    ],
  };
  assert.equal((await getUserSpending(database(tables), 'day', '2025-12-31')).totalCostUsd, 16);
  assert.equal((await getUserSpending(database(tables), 'month', '2025-12')).totalCostUsd, 20);
  assert.equal((await getUserSpending(database(tables), 'year', '2025')).totalCostUsd, 22);
  assert.equal((await getUserSpending(database(tables), 'all')).totalCostUsd, 78);
});
