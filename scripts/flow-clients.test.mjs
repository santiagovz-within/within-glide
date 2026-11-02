import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

const require = createRequire(import.meta.url);
function load(path, dependencies = {}) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const loadedModule = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(name => name in dependencies ? dependencies[name] : require(name), loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
const helpers = load('src/lib/flowClients.ts');
const owner = '00000000-0000-0000-0000-000000000001';
const adminId = '00000000-0000-0000-0000-000000000002';
const flowId = '00000000-0000-0000-0000-000000000003';
const otherFlow = '00000000-0000-0000-0000-000000000004';
const clientId = '00000000-0000-0000-0000-000000000005';

function database(tables, failure = false) {
  const calls = [];
  return { calls, auth: { getUser: async () => ({ data: { user: { id: owner } } }) }, from(table) {
    calls.push(table);
    const filters = [];
    return {
      select() { return this; }, eq(key, value) { filters.push(row => row[key] === value); return this; },
      async maybeSingle() { return { data: (tables[table] ?? []).find(row => filters.every(filter => filter(row))) ?? null, error: failure ? { message: 'offline' } : null }; },
      async single() { return this.maybeSingle(); },
    };
  } };
}

test('generation guard rejects missing tags, missing flows, other owners, invalid sources and lookup errors', async () => {
  for (const [tables, source, status, failure] of [
    [{ flows: [{ id: flowId, user_id: owner, client_id: null }] }, { sourceType: 'canvas', sourceId: flowId }, 409],
    [{ flows: [] }, { sourceType: 'canvas', sourceId: flowId }, 404],
    [{ flows: [{ id: flowId, user_id: adminId, client_id: clientId }] }, { sourceType: 'canvas', sourceId: flowId }, 404],
    [{}, { sourceType: 'canvas' }, 400],
    [{}, { sourceType: 'anything' }, 400],
    [{}, { sourceType: 'canvas', sourceId: 'invalid' }, 400],
    [{}, { sourceType: 'canvas', sourceId: flowId }, 503, true],
    [{ chat_sessions: [] }, { sourceType: 'chat', sourceId: flowId }, 404],
  ]) {
    await assert.rejects(helpers.requireGenerationClient(database(tables, failure), owner, source), error => error instanceof helpers.FlowClientError && error.status === status);
  }
  const db = database({ flows: [{ id: flowId, user_id: owner, client_id: clientId }], chat_sessions: [{ id: otherFlow, user_id: owner }] });
  assert.equal(await helpers.requireGenerationClient(db, owner, { sourceType: 'canvas', sourceId: flowId }), clientId);
  assert.equal(await helpers.requireGenerationClient(db, owner, { sourceType: 'chat', sourceId: otherFlow }), null);
  assert.equal(await helpers.requireGenerationClient(db, owner, { sourceType: 'chat' }), null);
});

test('client lookup rejects absent, malformed and unknown IDs and database failures', async () => {
  for (const id of [null, undefined, '', 123, 'unknown']) await assert.rejects(helpers.validateClient(database({}), id), /Choose a client/);
  await assert.rejects(helpers.validateClient(database({}), clientId), /unavailable/);
  await assert.rejects(helpers.validateClient(database({}, true), clientId), /verify/);
  assert.equal(await helpers.validateClient(database({ clients: [{ id: clientId }] }), clientId), clientId);
});

test('all Fal operations stop before storage side effects when a flow lacks a client', async () => {
  const db = database({ flows: [{ id: flowId, user_id: owner, client_id: null }] });
  const { getFalStorageHeaders } = load('src/lib/falStorage.ts', {
    'server-only': {}, '@/lib/flowClients': helpers, '@/lib/supabase/server': { createAdminClient: () => db },
  });
  await assert.rejects(getFalStorageHeaders({ userId: owner, sourceType: 'canvas', sourceId: flowId }), /Choose a client/);
  assert.deepEqual(db.calls, ['flows']);
});

test('client mutations reject anonymous/non-admin users before writing', async () => {
  for (const signedIn of [false, true]) {
    const db = database({ profiles: [{ id: owner, is_admin: false }] });
    if (!signedIn) db.auth.getUser = async () => ({ data: { user: null } });
    const route = load('src/app/api/clients/route.ts', { '@/lib/supabase/server': { createClient: async () => db }, '@/lib/flowClients': helpers });
    for (const method of ['POST', 'PATCH']) {
      const result = await route[method](new Request('http://localhost/api/clients', { method, body: JSON.stringify({ name: 'Injected', id: clientId }) }));
      assert.equal(result.status, signedIn ? 403 : 401);
    }
    assert.ok(!db.calls.includes('clients'));
  }
});

test('flow assignment rejects non-owners and forks require an explicit valid client', async () => {
  const db = database({ flows: [{ id: flowId, user_id: adminId, is_shared: true }] });
  const server = { createClient: async () => db, createAdminClient: () => db };
  const route = load('src/app/api/flows/[flowId]/route.ts', {
    '@/lib/supabase/server': server, '@/lib/flowClients': helpers,
    '@/lib/flowMedia': {}, '@/lib/utils/flowPersistence': {},
  });
  const response = await route.PATCH(new Request('http://localhost/api/flows/id', { method: 'PATCH', body: JSON.stringify({ client_id: clientId }) }), { params: Promise.resolve({ flowId }) });
  assert.equal(response.status, 403);
  const fork = load('src/app/api/flows/[flowId]/fork/route.ts', { '@/lib/supabase/server': server, '@/lib/flowClients': helpers });
  for (const body of [{}, { client_id: null }, { client_id: 'invalid' }]) {
    assert.equal((await fork.POST(new Request('http://localhost/fork', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ flowId }) })).status, 400);
  }
});

test('migration enforces attribution, backfills historical costs, preserves completions and restricts client management in Postgres', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY, is_admin boolean);
    CREATE TABLE public.flows(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, created_at timestamptz DEFAULT now());
    CREATE TABLE public.generations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, source_type text, source_id text, status text, fal_cost_usd numeric, created_at timestamptz DEFAULT now());
    GRANT SELECT ON public.profiles TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.flows, public.generations TO authenticated;
    ALTER TABLE public.flows ENABLE ROW LEVEL SECURITY;
    CREATE POLICY flow_owner ON public.flows TO authenticated USING(user_id = auth.uid()) WITH CHECK(user_id = auth.uid());
    ALTER TABLE public.generations ENABLE ROW LEVEL SECURITY;
    CREATE POLICY generation_owner ON public.generations TO authenticated USING(user_id = auth.uid()) WITH CHECK(user_id = auth.uid());
    INSERT INTO public.profiles VALUES ('${owner}', false), ('${adminId}', true);
    INSERT INTO public.flows(id, user_id, title) VALUES ('${flowId}', '${owner}', 'Legacy'), ('${otherFlow}', '${adminId}', 'Other');
    INSERT INTO public.generations(user_id, source_type, source_id, status, fal_cost_usd) VALUES
      ('${owner}', 'canvas', '${flowId}', 'completed', 12.5), ('${owner}', 'canvas', '${flowId}', 'processing', NULL);
  `);
  await db.exec(readFileSync(new URL('../supabase/migrations/016_flow_clients.sql', import.meta.url), 'utf8'));
  const clients = (await db.query('SELECT id, name FROM public.clients ORDER BY name')).rows;
  assert.equal(clients.length, 36);
  assert.ok(clients.some(c => c.name === "Anthony's Goods"));
  assert.ok(clients.some(c => c.name === 'Vans, A VF Company'));
  const [first, second] = clients;
  // Reproduce the production failure with its real polymorphic text source ID.
  await assert.rejects(db.query('UPDATE public.flows SET client_id = $1 WHERE id = $2', [first.id, flowId]), /operator does not exist: text = uuid/);
  await db.exec(readFileSync(new URL('../supabase/migrations/017_fix_flow_client_source_types.sql', import.meta.url), 'utf8'));
  await db.exec(`SET ROLE authenticated; SET app.user_id = '${owner}';`);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.clients')).rows[0].n, 36);
  await assert.rejects(db.query("INSERT INTO public.clients(name) VALUES ('Not an admin')"), /row-level security/);
  assert.equal((await db.query("UPDATE public.clients SET name = 'Forbidden' RETURNING id")).rows.length, 0);
  await assert.rejects(db.query('DELETE FROM public.clients'), /permission denied/);
  await assert.rejects(db.query('INSERT INTO public.flows(user_id, title) VALUES ($1, $2)', [owner, 'No client']), /Choose a client/);
  await assert.rejects(db.query("INSERT INTO public.generations(user_id, source_type, source_id) VALUES ($1, 'canvas', $2)", [owner, flowId]), /Choose a client/);
  await assert.rejects(db.query("INSERT INTO public.generations(user_id, source_type, source_id) VALUES ($1, 'canvas', $2)", [owner, otherFlow]), /owned flow/);
  // Finishing old work is allowed while tagging is pending.
  await db.query("UPDATE public.generations SET status = 'completed', fal_cost_usd = 3 WHERE status = 'processing'");
  await db.query('UPDATE public.flows SET client_id = $1 WHERE id = $2', [first.id, flowId]);
  let costs = (await db.query('SELECT client_id, sum(fal_cost_usd)::float AS cost FROM public.generations GROUP BY client_id')).rows;
  assert.deepEqual(costs, [{ client_id: first.id, cost: 15.5 }]);
  await assert.rejects(db.query('UPDATE public.flows SET client_id = NULL WHERE id = $1', [flowId]), /Choose a client/);
  await assert.rejects(db.query('UPDATE public.flows SET client_id = $1 WHERE id = $2', [clientId, flowId]), /foreign key/);
  // The DB ignores a forged client ID on new generation rows.
  const inserted = (await db.query("INSERT INTO public.generations(user_id, source_type, source_id, client_id, status, fal_cost_usd) VALUES ($1, 'canvas', $2, $3, 'completed', 2) RETURNING id, client_id", [owner, flowId, second.id])).rows[0];
  assert.equal(inserted.client_id, first.id);
  await assert.rejects(db.query('UPDATE public.generations SET client_id = $1 WHERE id = $2', [second.id, inserted.id]), /Change the client on the flow/);
  await assert.rejects(db.query('UPDATE public.generations SET source_id = $1 WHERE id = $2', [otherFlow, inserted.id]), /source cannot be changed/);
  await db.query('UPDATE public.flows SET client_id = $1 WHERE id = $2', [second.id, flowId]);
  costs = (await db.query('SELECT client_id, sum(fal_cost_usd)::float AS cost FROM public.generations GROUP BY client_id')).rows;
  assert.deepEqual(costs, [{ client_id: second.id, cost: 17.5 }]);
  const chat = (await db.query("INSERT INTO public.generations(user_id, source_type, client_id) VALUES ($1, 'chat', $2) RETURNING client_id", [owner, first.id])).rows[0];
  assert.equal(chat.client_id, null);
  // Attribution survives deletion of its workflow.
  await db.query('DELETE FROM public.flows WHERE id = $1', [flowId]);
  assert.equal((await db.query('SELECT client_id FROM public.generations WHERE id = $1', [inserted.id])).rows[0].client_id, second.id);
  await db.exec(`SET app.user_id = '${adminId}';`);
  const added = (await db.query("INSERT INTO public.clients(name) VALUES ('New Client') RETURNING id")).rows[0];
  await db.query("UPDATE public.clients SET name = 'Updated Client' WHERE id = $1", [added.id]);
  assert.equal((await db.query('SELECT name FROM public.clients WHERE id = $1', [added.id])).rows[0].name, 'Updated Client');
  await assert.rejects(db.query("INSERT INTO public.clients(name) VALUES ('updated client')"), /unique constraint/);
  await assert.rejects(db.query("INSERT INTO public.clients(name) VALUES ('  ' )"), /check constraint/);
});

test('only an opened, owned, unassigned flow requires tagging; save failures do not unlock it', async () => {
  const writes = [];
  const assigned = [];
  let fail = true;
  let cancelled = false;
  const Picker = () => null;
  const { FlowClientGate } = load('src/components/clients/FlowClientGate.tsx', {
    './ClientPickerDialog': {
      ClientPickerDialog: Picker,
      assignFlowClient: async (flow, client) => {
        writes.push({ flow, client });
        if (fail) throw new Error('Save failed');
      },
    },
  });
  const children = 'canvas';
  const props = { isOwner: true, children, onClientAssigned: client => assigned.push(client), onCancel: () => { cancelled = true; } };
  const flow = { id: flowId, title: 'Opened workflow', client_id: null };
  assert.equal(FlowClientGate({ ...props, flow: { ...flow, client_id: clientId } }), children);
  assert.equal(FlowClientGate({ ...props, flow, isOwner: false }), children);
  assert.equal(FlowClientGate({ ...props, flow: null }).props.role, 'status');
  const picker = FlowClientGate({ ...props, flow });
  assert.equal(picker.type, Picker);
  assert.equal(picker.props.submitLabel, 'Save and open flow');
  picker.props.onCancel();
  assert.equal(cancelled, true);
  const client = { id: clientId, name: 'Selected client' };
  await assert.rejects(picker.props.onSubmit(client), /Save failed/);
  assert.equal(assigned.length, 0);
  fail = false;
  await picker.props.onSubmit(client);
  assert.deepEqual(writes, [{ flow: flowId, client: clientId }, { flow: flowId, client: clientId }]);
  assert.deepEqual(assigned, [client]);
});
