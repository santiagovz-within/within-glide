import type { Edge, Node } from '@xyflow/react';
import type { ImageGenNodeData, NodeData, ReferenceVideoNodeData, VideoGenNodeData } from '@/types';
import { getTaggableInputs, reconcileMediaPromptTags, referenceHandleIndex } from '@/lib/promptTags';
import { getReferenceVideoTaggableInputs } from './referenceVideoInputs';

/** Only references in the same node and modality can exchange positions. */
export function orderedInputEdges(node: Node<NodeData>, edges: Edge[], edgeId: string): Edge[] {
  const edge = edges.find(edge => edge.id === edgeId && edge.target === node.id);
  if (!edge) return [];
  const incoming = edges.filter(candidate => candidate.target === node.id);
  if (node.type === 'referenceVideoNode' && ['reference_images', 'reference_videos'].includes(edge.targetHandle ?? '')) {
    return incoming.filter(candidate => candidate.targetHandle === edge.targetHandle);
  }
  if (node.type === 'imageGenNode' && edge.targetHandle?.startsWith('ref_')) {
    return incoming.filter(candidate => candidate.targetHandle?.startsWith('ref_'))
      .sort((a, b) => referenceHandleIndex(a.targetHandle)! - referenceHandleIndex(b.targetHandle)!);
  }
  if (node.type === 'videoGenNode' && ['start_frame', 'end_frame'].includes(edge.targetHandle ?? '')) {
    return incoming.filter(candidate => ['start_frame', 'end_frame'].includes(candidate.targetHandle ?? ''))
      .sort((a, b) => Number(a.targetHandle === 'end_frame') - Number(b.targetHandle === 'end_frame'));
  }
  return [];
}

/** Update connections, cached input URLs and pinned prompt tags in one transaction. */
export function reorderInputConnections(nodes: Node<NodeData>[], edges: Edge[], nodeId: string, fromId: string, toId: string) {
  const node = nodes.find(node => node.id === nodeId);
  if (!node || fromId === toId) return null;
  const group = orderedInputEdges(node, edges, fromId);
  const from = group.findIndex(edge => edge.id === fromId);
  const to = group.findIndex(edge => edge.id === toId);
  if (from < 0 || to < 0) return null;
  const reordered = [...group];
  reordered.splice(to, 0, ...reordered.splice(from, 1));
  const groupIds = new Set(group.map(edge => edge.id));
  let nextEdges: Edge[];
  let data = node.data;

  if (node.type === 'referenceVideoNode') {
    let index = 0;
    nextEdges = edges.map(edge => groupIds.has(edge.id) ? reordered[index++] : edge);
    const current = data as ReferenceVideoNodeData;
    const fixed = !current.promptConnected && reconcileMediaPromptTags(current.prompt ?? '', current.promptTags ?? [],
      getReferenceVideoTaggableInputs(nodeId, nodes, nextEdges));
    if (fixed) data = { ...current, prompt: fixed.prompt, promptTags: fixed.tags };
  } else {
    // These nodes use numbered/semantic handles, so move the connections between
    // the occupied slots as well as their cached URLs. Keep edge identity intact.
    const handles = new Map(reordered.map((edge, index) => [edge.id, group[index].targetHandle]));
    nextEdges = edges.map(edge => groupIds.has(edge.id) ? { ...edge, targetHandle: handles.get(edge.id) } : edge);
    if (node.type === 'imageGenNode') {
      const current = data as ImageGenNodeData;
      const inputImageUrls = [...(current.inputImageUrls ?? [])];
      reordered.forEach((edge, index) => {
        inputImageUrls[referenceHandleIndex(group[index].targetHandle)!] = current.inputImageUrls?.[referenceHandleIndex(edge.targetHandle)!] ?? '';
      });
      const fixed = !current.promptConnected && reconcileMediaPromptTags(current.prompt ?? '', current.promptTags ?? [],
        getTaggableInputs(nodeId, nextEdges, inputImageUrls));
      data = { ...current, inputImageUrls, ...(fixed ? { prompt: fixed.prompt, promptTags: fixed.tags } : {}) };
    } else {
      const current = data as VideoGenNodeData;
      data = { ...current, startFrameUrl: current.endFrameUrl, endFrameUrl: current.startFrameUrl };
    }
  }
  return { nodes: nodes.map(candidate => candidate.id === nodeId ? { ...candidate, data } : candidate), edges: nextEdges };
}
