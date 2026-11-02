import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isClientId } from '@/lib/flowClients';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const clients = [];
  for (let from = 0; ; ) {
    const { data, error } = await supabase.from('clients').select('id, name, created_at, updated_at')
      .order('name').order('id').range(from, from + 999);
    if (error) return NextResponse.json({ error: 'Could not load clients' }, { status: 500 });
    clients.push(...data);
    if (!data.length) break;
    from += data.length;
  }
  return NextResponse.json({ clients });
}

async function save(request: NextRequest, updating: boolean) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single();
  if (!profile?.is_admin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 120 || (updating && !isClientId(body?.id))) {
    return NextResponse.json({ error: 'Enter a client name between 1 and 120 characters and a valid client ID when updating.' }, { status: 400 });
  }
  const query = updating
    ? supabase.from('clients').update({ name, updated_at: new Date().toISOString() }).eq('id', body.id)
    : supabase.from('clients').insert({ name });
  const { data, error } = await query.select('id, name, created_at, updated_at').maybeSingle();
  if (error) return NextResponse.json({ error: error.code === '23505' ? 'A client with this name already exists.' : 'Could not save client.' }, { status: error.code === '23505' ? 409 : 500 });
  if (!data) return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  return NextResponse.json({ client: data }, { status: updating ? 200 : 201 });
}

export const POST = (request: NextRequest) => save(request, false);
export const PATCH = (request: NextRequest) => save(request, true);
