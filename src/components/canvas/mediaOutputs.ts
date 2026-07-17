import type { Edge, Node } from '@xyflow/react';
import type {
  ImageGenNodeData,
  ImageInputNodeData,
  MediaInputNodeData,
  ModifyNodeData,
  NodeData,
  NodeType,
  RemoveBgNodeData,
  SelectNodeData,
  UpscaleMediaNodeData,
  UpscaleNodeData,
  VideoGenNodeData,
  VideoInputNodeData,
  VideoToGifNodeData,
  VideoUpscaleNodeData,
} from '@/types';
import { PORT_TYPE_MAP } from './nodes/TypedHandle';

export type CanvasMediaType = 'image' | 'video';

const STATIC_MEDIA_SOURCE_HANDLES: Partial<
  Record<NodeType, Partial<Record<CanvasMediaType, string>>>
> = {
  imageInputNode: { image: 'image' },
  imageGenNode: { image: 'image' },
  videoGenNode: { video: 'video' },
  upscaleNode: { image: 'image' },
  selectNode: { image: 'image' },
  videoToGifNode: { image: 'gif' },
  removeBgNode: { image: 'image' },
  videoInputNode: { video: 'video' },
  videoUpscaleNode: { video: 'video' },
};

export function getSourceMediaType(
  node: Node<NodeData> | undefined,
  sourceHandle: string | null | undefined
): CanvasMediaType | null {
  if (!node?.type || !sourceHandle) return null;
  const portType = PORT_TYPE_MAP[`${node.type}:${sourceHandle}:source`];
  return portType === 'image' || portType === 'video' ? portType : null;
}

function getIncomingMediaType(
  nodeId: string,
  targetHandle: string,
  nodes: Node<NodeData>[],
  edges: Edge[]
): CanvasMediaType | null {
  const incomingEdge = edges.find(
    (edge) => edge.target === nodeId && edge.targetHandle === targetHandle
  );
  if (!incomingEdge) return null;
  const sourceNode = nodes.find((node) => node.id === incomingEdge.source);
  return getSourceMediaType(sourceNode, incomingEdge.sourceHandle);
}

export function getActiveMediaSourceHandle(
  node: Node<NodeData>,
  mediaType: CanvasMediaType,
  nodes: Node<NodeData>[],
  edges: Edge[]
): string | null {
  if (node.type === 'mediaInputNode') {
    const activeType = (node.data as MediaInputNodeData).mediaType ?? 'image';
    return activeType === mediaType ? activeType : null;
  }

  if (node.type === 'modifyNode') {
    const activeType = getIncomingMediaType(node.id, 'image', nodes, edges);
    return activeType === mediaType ? mediaType : null;
  }

  if (node.type === 'upscaleMediaNode') {
    const activeType = getIncomingMediaType(node.id, 'media', nodes, edges);
    return activeType === mediaType ? mediaType : null;
  }

  return STATIC_MEDIA_SOURCE_HANDLES[node.type as NodeType]?.[mediaType] ?? null;
}

export function getNodeMediaUrls(
  node: Node<NodeData>,
  mediaType: CanvasMediaType
): string[] {
  if (mediaType === 'image') {
    switch (node.type) {
      case 'imageInputNode':
        return [(node.data as ImageInputNodeData).imageUrl].filter(Boolean) as string[];
      case 'imageGenNode':
        return (node.data as ImageGenNodeData).generatedImages ?? [];
      case 'upscaleNode':
        return [(node.data as UpscaleNodeData).outputImageUrl].filter(Boolean) as string[];
      case 'modifyNode':
        return [(node.data as ModifyNodeData).outputImageUrl].filter(Boolean) as string[];
      case 'selectNode':
        return [(node.data as SelectNodeData).selectedImageUrl].filter(Boolean) as string[];
      case 'videoToGifNode':
        return [(node.data as VideoToGifNodeData).gifUrl].filter(Boolean) as string[];
      case 'removeBgNode':
        return [(node.data as RemoveBgNodeData).outputImageUrl].filter(Boolean) as string[];
      case 'mediaInputNode':
        return [(node.data as MediaInputNodeData).imageUrl].filter(Boolean) as string[];
      case 'upscaleMediaNode': {
        const data = node.data as UpscaleMediaNodeData;
        const bulkUrls = (data.bulkResults ?? [])
          .filter((result) => result.status === 'completed' && result.outputUrl)
          .map((result) => result.outputUrl as string);
        return bulkUrls.length > 0
          ? bulkUrls
          : [data.outputImageUrl].filter(Boolean) as string[];
      }
      default:
        return [];
    }
  }

  switch (node.type) {
    case 'videoGenNode':
      return [(node.data as VideoGenNodeData).videoUrl].filter(Boolean) as string[];
    case 'videoInputNode':
      return [(node.data as VideoInputNodeData).videoUrl].filter(Boolean) as string[];
    case 'mediaInputNode':
      return [(node.data as MediaInputNodeData).videoUrl].filter(Boolean) as string[];
    case 'videoUpscaleNode':
      return [(node.data as VideoUpscaleNodeData).videoUrl].filter(Boolean) as string[];
    case 'modifyNode':
      return [(node.data as ModifyNodeData).outputVideoUrl].filter(Boolean) as string[];
    case 'upscaleMediaNode': {
      const data = node.data as UpscaleMediaNodeData;
      const bulkUrls = (data.bulkResults ?? [])
        .filter((result) => result.status === 'completed' && result.outputUrl)
        .map((result) => result.outputUrl as string);
      return bulkUrls.length > 0
        ? bulkUrls
        : [data.outputVideoUrl].filter(Boolean) as string[];
    }
    default:
      return [];
  }
}
