import { FlowClientError, validateClient } from '@/lib/flowClients';
import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

// POST /api/flows/[flowId]/fork
// Creates a copy of a shared flow in the current user's workspace.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ flowId: string }> },
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => null);
    const clientId = await validateClient(supabase, body?.client_id);
    const { flowId } = await params;
    const admin = createAdminClient();

    const { data: source } = await admin
      .from('flows')
      .select('title, flow_data, is_shared, lifecycle_state')
      .eq('id', flowId)
      .single();

    if (!source?.is_shared || source.lifecycle_state !== 'active') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { data: fork, error } = await supabase
      .from('flows')
      .insert({
        user_id: user.id,
        client_id: clientId,
        title: `${source.title} (fork)`,
        flow_data: source.flow_data,
        is_template: false,
        is_shared: false,
        lifecycle_state: 'active',
      })
      .select('id')
      .single();

    if (error || !fork) {
      return NextResponse.json({ error: 'Failed to fork' }, { status: 500 });
    }

    return NextResponse.json({ flowId: fork.id });
  } catch (err) {
    if (err instanceof FlowClientError) return NextResponse.json({ error: err.message }, { status: err.status });
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[flows/fork] POST error:', detail);
    return NextResponse.json({ error: 'Failed to fork flow' }, { status: 500 });
  }
}
