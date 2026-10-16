import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { FAL_MODELS } from '@/lib/api/models';
import type { FlowData, NodeType } from '@/types';

interface TrackedJob {
  id: string;
  flowId: string;
  nodeId: string;
}

// Supabase caps result sets. Recovery must not silently omit older jobs when
// an account has more than one page of flows or generations.
const PAGE_SIZE = 500;

function resolveEndpoint(
  model: string,
  parameters: Record<string, unknown> | null,
  referenceImageUrls: string[] | null,
  nodeData: Record<string, unknown>,
  requestId: string,
): string | null {
  if (typeof parameters?.endpoint === 'string') return parameters.endpoint;
  const pendingRequests = Array.isArray(nodeData.pendingRequests)
    ? nodeData.pendingRequests as Array<{ requestId?: string; endpoint?: string }>
    : [];
  const savedRequest = pendingRequests.find((request) => request.requestId === requestId);
  if (typeof savedRequest?.endpoint === 'string') return savedRequest.endpoint;
  if (
    nodeData.pendingRequestId === requestId
    && typeof nodeData.pendingEndpoint === 'string'
  ) {
    return nodeData.pendingEndpoint;
  }
  if (model.startsWith('fal-ai/')) return model;
  const config = FAL_MODELS[model as keyof typeof FAL_MODELS];
  if (!config) return null;
  if (
    (referenceImageUrls?.length || (Array.isArray(nodeData.inputImageUrls) && nodeData.inputImageUrls.length > 0))
    && 'editEndpoint' in config
  ) {
    return config.editEndpoint as string;
  }
  if (nodeData.startFrameUrl && 'imageToVideoEndpoint' in config) {
    return config.imageToVideoEndpoint as string;
  }
  return config.endpoint as string;
}

async function recover(trackedJobs: TrackedJob[]) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = createAdminClient();
    const pending = [];
    const selection = 'source_id, node_id, model, media_type, fal_request_id, parameters, reference_image_urls, created_at';
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await admin.from('generations')
        .select(selection)
        .eq('user_id', user.id)
        .eq('source_type', 'canvas')
        .eq('status', 'processing')
        .not('source_id', 'is', null)
        .not('node_id', 'is', null)
        .not('fal_request_id', 'is', null)
        .order('created_at', { ascending: true })
        .order('id')
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      pending.push(...(data ?? []));
      if (!data || data.length < PAGE_SIZE) break;
    }

    // Only read flows that have a processing node or are needed to reconcile
    // a tracked/requested job; do not download every finished canvas every 15s.
    const flows = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await admin.from('flows')
        .select('id, title, flow_data')
        .eq('user_id', user.id)
        .contains('flow_data', { nodes: [{ data: { status: 'processing' } }] })
        .order('id')
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      flows.push(...(data ?? []));
      if (!data || data.length < PAGE_SIZE) break;
    }
    const flowMap = new Map(flows.map((flow) => [flow.id, flow]));
    const otherFlowIds = [...new Set([
      ...trackedJobs.map((job) => job.flowId),
      ...pending.map((generation) => generation.source_id as string),
    ])].filter((id) => !flowMap.has(id));
    for (let offset = 0; offset < otherFlowIds.length; offset += PAGE_SIZE) {
      const { data, error } = await admin.from('flows')
        .select('id, title, flow_data')
        .eq('user_id', user.id)
        .in('id', otherFlowIds.slice(offset, offset + PAGE_SIZE));
      if (error) throw new Error(error.message);
      for (const flow of data ?? []) flowMap.set(flow.id, flow);
    }

    // A different tab may have persisted a result just before this tab closed.
    // Include terminal rows still referenced by a node, so reopening finishes
    // the node instead of leaving it processing forever.
    const knownIds = new Set(pending.map((generation) => generation.fal_request_id));
    const savedIds = new Set<string>();
    for (const flow of flowMap.values()) {
      for (const node of (flow.flow_data as FlowData | undefined)?.nodes ?? []) {
        const data = node.data as Record<string, unknown>;
        if (typeof data.pendingRequestId === 'string') savedIds.add(data.pendingRequestId);
        if (Array.isArray(data.pendingRequests)) {
          for (const request of data.pendingRequests) {
            if (typeof request?.requestId === 'string') savedIds.add(request.requestId);
          }
        }
      }
    }
    const missingIds = [...savedIds].filter((id) => !knownIds.has(id));
    for (let offset = 0; offset < missingIds.length; offset += PAGE_SIZE) {
      const { data, error } = await admin.from('generations')
        .select(selection)
        .eq('user_id', user.id)
        .eq('source_type', 'canvas')
        .in('fal_request_id', missingIds.slice(offset, offset + PAGE_SIZE));
      if (error) throw new Error(error.message);
      pending.push(...(data ?? []));
    }
    pending.sort((a, b) => a.created_at.localeCompare(b.created_at));

    const generations = (pending ?? []).flatMap((generation) => {
      const flow = flowMap.get(generation.source_id as string);
      const flowData = flow?.flow_data as FlowData | undefined;
      const node = flowData?.nodes?.find((candidate) => candidate.id === generation.node_id);
      if (!flow || !node || !generation.fal_request_id) return [];
      if (node.type !== 'imageGenNode' && node.type !== 'videoGenNode' && node.type !== 'referenceVideoNode') return [];
      // Old processing rows must not resurrect a node whose batch has ended.
      const nodeData = node.data as Record<string, unknown>;
      const savedRequests = Array.isArray(nodeData.pendingRequests)
        ? nodeData.pendingRequests as Array<{ requestId: string; slotIndex?: number }> : [];
      const savedIds = [
        ...savedRequests.map((request) => request.requestId),
        ...(typeof nodeData.pendingRequestId === 'string' ? [nodeData.pendingRequestId] : []),
      ];
      if (savedIds.length > 0) {
        if (!savedIds.includes(generation.fal_request_id)) return [];
      } else if (nodeData.status !== 'processing') {
        return [];
      }
      const parameters = generation.parameters as Record<string, unknown> | null;
      const endpoint = resolveEndpoint(
        generation.model,
        parameters,
        generation.reference_image_urls as string[] | null,
        node.data as Record<string, unknown>,
        generation.fal_request_id,
      );
      if (!endpoint) return [];
      return [{
        flowId: flow.id,
        flowTitle: flow.title,
        nodeId: node.id,
        nodeType: node.type as NodeType,
        nodeData: node.data,
        requestId: generation.fal_request_id,
        endpoint,
        mediaType: generation.media_type === 'image' ? 'image' as const : 'video' as const,
        slotIndex: typeof parameters?.slotIndex === 'number'
          ? parameters.slotIndex
          : savedRequests.find((request) => request.requestId === generation.fal_request_id)?.slotIndex,
        createdAt: generation.created_at,
      }];
    });

    const removedJobIds = trackedJobs.filter((job) => {
      const flow = flowMap.get(job.flowId);
      return !(flow?.flow_data as FlowData | undefined)?.nodes?.some((node) => node.id === job.nodeId);
    }).map((job) => job.id);
    return NextResponse.json({ generations, removedJobIds });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('[generations/pending] GET error:', detail);
    return NextResponse.json({ error: 'Failed to load pending generations' }, { status: 500 });
  }
}

export async function GET() {
  return recover([]);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.jobs) || body.jobs.length > 1000 || body.jobs.some(
    (job: TrackedJob) => !job || typeof job.id !== 'string'
      || typeof job.flowId !== 'string' || typeof job.nodeId !== 'string',
  )) {
    return NextResponse.json({ error: 'Invalid tracked jobs' }, { status: 400 });
  }
  return recover(body.jobs);
}
