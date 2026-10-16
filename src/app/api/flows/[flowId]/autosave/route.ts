import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { signFlowMedia } from '@/lib/flowMedia';
import { mergeGenerationNodes } from '@/lib/generationReconciliation';
import { shouldActivateFlow } from '@/lib/utils/flowPersistence';
import type { FlowData } from '@/types';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ flowId: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { flowId } = await params;
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.flowData?.nodes) || !Array.isArray(body.flowData?.edges)
    || !Array.isArray(body.baseNodes)) {
    return NextResponse.json({ error: 'Canvas and base snapshot are required' }, { status: 400 });
  }
  const admin = createAdminClient();
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: flow, error } = await admin.from('flows').select('user_id, flow_data, updated_at, lifecycle_state')
      .eq('id', flowId).maybeSingle();
    if (error) return NextResponse.json({ error: 'Could not read canvas' }, { status: 500 });
    if (!flow) return NextResponse.json({ error: 'Flow not found' }, { status: 404 });
    if (flow.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const saved = flow.flow_data as FlowData;
    const flowData: FlowData = { ...body.flowData,
      nodes: mergeGenerationNodes(body.flowData.nodes, saved.nodes ?? [], body.baseNodes) };
    const nodeIds = new Set(flowData.nodes.map((node) => node.id));
    flowData.edges = flowData.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(flow.updated_at) + 1)).toISOString();
    const lifecycle = flow.lifecycle_state === 'draft' && shouldActivateFlow(flowData.nodes)
      ? 'active' : flow.lifecycle_state;
    const { data: updated, error: writeError } = await admin.from('flows').update({
      flow_data: flowData, updated_at: updatedAt, lifecycle_state: lifecycle,
      ...(body.thumbnailUrl === null || typeof body.thumbnailUrl === 'string' ? { thumbnail_url: body.thumbnailUrl } : {}),
    }).eq('id', flowId).eq('user_id', user.id).eq('updated_at', flow.updated_at).select('id');
    if (writeError) return NextResponse.json({ error: 'Could not save canvas' }, { status: 500 });
    if (updated?.length) return NextResponse.json({ flowData: await signFlowMedia(flowData), updatedAt, lifecycle });
  }
  return NextResponse.json({ error: 'Canvas changed while saving; retrying is safe' }, { status: 409 });
}
