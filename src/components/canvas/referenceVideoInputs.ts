import type { Edge, Node } from '@xyflow/react';
import type { TaggableInput } from '@/lib/promptTags';
import type { NodeData } from '@/types';
import { getNodeMediaUrls } from './mediaOutputs';

export const REFERENCE_IMAGE_HANDLE = 'reference_images';
export const REFERENCE_VIDEO_HANDLE = 'reference_videos';

// Read directly from the graph: disconnects, source changes, history navigation,
// and loading a saved flow all resolve the same current references.
export function getReferenceVideoInputs(nodeId: string, nodes: Node<NodeData>[], edges: Edge[]) {
  function references(handle: string, kind: 'image' | 'video') {
    return edges.filter(edge => edge.target === nodeId && edge.targetHandle === handle).map(edge => {
      const source = nodes.find(node => node.id === edge.source);
      return { edgeId: edge.id, sourceNodeId: edge.source, url: source ? getNodeMediaUrls(source, kind)[0] : undefined };
    });
  }
  return {
    images: references(REFERENCE_IMAGE_HANDLE, 'image'),
    videos: references(REFERENCE_VIDEO_HANDLE, 'video'),
  };
}

export function getReferenceVideoTaggableInputs(nodeId: string, nodes: Node<NodeData>[], edges: Edge[]): TaggableInput[] {
  const references = getReferenceVideoInputs(nodeId, nodes, edges);
  return (['image', 'video'] as const).flatMap(kind =>
    (kind === 'image' ? references.images : references.videos).map((reference, portIndex) => ({
      ...reference, portIndex, label: `${kind}${portIndex + 1}`, mediaType: kind, url: reference.url ?? '',
    })));
}
