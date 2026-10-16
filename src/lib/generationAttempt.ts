import type { createClient } from '@/lib/supabase/server';
import { generationIdentity } from '@/lib/generationReconciliation';
import type { FlowData } from '@/types';

export interface GenerationAttemptInput {
  sourceType: 'canvas' | 'chat';
  sourceId?: string;
  nodeId?: string;
  generationRunId?: string;
  previousIdentity?: string;
  generationSlotCount?: number;
}

/** Reserve an exact attempt before paid work starts, independently of autosave. */
export async function registerGenerationAttempt(
  client: Awaited<ReturnType<typeof createClient>>, userId: string, input: GenerationAttemptInput,
) {
  // Older clients and chat requests have no attempt token.
  if (input.sourceType !== 'canvas' || !input.generationRunId) return;
  if (!input.sourceId || !input.nodeId || typeof input.previousIdentity !== 'string'
    || typeof input.generationRunId !== 'string') throw new Error('Invalid generation attempt');
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: flow, error } = await client.from('flows').select('flow_data, updated_at, lifecycle_state')
      .eq('id', input.sourceId).eq('user_id', userId).maybeSingle();
    if (error || !flow) throw new Error('Could not load the canvas for this generation');
    const flowData = flow.flow_data as FlowData;
    const existing = flowData.nodes.find((node) => node.id === input.nodeId);
    if (existing?.data.generationRunId === input.generationRunId) return; // Other batch slots.
    if (existing && generationIdentity(existing.data) !== input.previousIdentity) {
      throw new Error('This node changed in another tab. Reload the canvas before generating again.');
    }
    if (!existing) {
      // Let the normal canvas autosave finish for a newly added node. Never
      // recreate a missing node from a delayed submission after deletion.
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        continue;
      }
      throw new Error('This node was removed or has not been saved yet. Save the canvas and try again.');
    }
    const node = existing;
    if (!node || node.id !== input.nodeId
      || !['imageGenNode', 'videoGenNode', 'referenceVideoNode'].includes(node.type)) {
      throw new Error('The generation node could not be saved');
    }
    const data: Record<string, unknown> = { ...node.data, status: 'processing' as const, generationRunId: input.generationRunId };
    for (const key of ['pendingRequests', 'pendingRequestId', 'pendingEndpoint', 'resolvedRequestIds', 'errorMessage', 'errorRequestId']) {
      delete data[key];
    }
    if (node.type === 'imageGenNode') {
      const count = input.generationSlotCount ?? Number(node.data.numImages ?? 1);
      if (!Number.isInteger(count) || count < 1 || count > 4) throw new Error('Invalid generation batch size');
      data.generationSlots = Array<string | null>(count).fill(null);
      data.generatedImages = [];
      delete data.generationErrors;
    }
    const nextNode = { ...node, data: data as typeof node.data };
    const nodes = flowData.nodes.map((candidate) => candidate.id === node.id ? nextNode : candidate);
    const { data: updated, error: saveError } = await client.from('flows').update({
      flow_data: { ...flowData, nodes }, lifecycle_state: 'active',
      updated_at: new Date(Math.max(Date.now(), Date.parse(flow.updated_at) + 1)).toISOString(),
    }).eq('id', input.sourceId).eq('user_id', userId).eq('updated_at', flow.updated_at).select('id');
    if (saveError) throw new Error('Could not save the generation attempt');
    if (updated?.length) return;
  }
  throw new Error('The canvas changed while starting this generation. Please try again.');
}
