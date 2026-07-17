import type { Node } from '@xyflow/react';
import type {
  ImageGenNodeData,
  ImageInputNodeData,
  MediaInputNodeData,
  ModifyNodeData,
  NodeData,
  OutputNodeData,
  RemoveBgNodeData,
  SelectNodeData,
  UpscaleMediaNodeData,
  UpscaleNodeData,
  VideoToGifNodeData,
} from '@/types';
import { compressToThumbnailDataUrl } from './imageProcessing';

const THUMBNAIL_NODE_PRIORITY = [
  'outputNode',
  'selectNode',
  'removeBgNode',
  'modifyNode',
  'videoToGifNode',
  'upscaleMediaNode',
  'upscaleNode',
  'imageGenNode',
  'mediaInputNode',
  'imageInputNode',
] as const;

function imageUrlForNode(node: Node<NodeData>): string | undefined {
  switch (node.type) {
    case 'outputNode': {
      const data = node.data as OutputNodeData;
      return data.mediaType === 'image' ? data.mediaUrl : undefined;
    }
    case 'selectNode':
      return (node.data as SelectNodeData).selectedImageUrl;
    case 'removeBgNode':
      return (node.data as RemoveBgNodeData).outputImageUrl;
    case 'modifyNode':
      return (node.data as ModifyNodeData).outputImageUrl;
    case 'videoToGifNode':
      return (node.data as VideoToGifNodeData).gifUrl;
    case 'upscaleMediaNode':
      return (node.data as UpscaleMediaNodeData).outputImageUrl;
    case 'upscaleNode':
      return (node.data as UpscaleNodeData).outputImageUrl;
    case 'imageGenNode': {
      const data = node.data as ImageGenNodeData;
      return data.generatedImages?.[0] ?? data.generationHistory?.at(-1)?.[0];
    }
    case 'mediaInputNode': {
      const data = node.data as MediaInputNodeData;
      return data.mediaType === 'image' ? data.imageUrl : undefined;
    }
    case 'imageInputNode':
      return (node.data as ImageInputNodeData).imageUrl;
    default:
      return undefined;
  }
}

export function extractFlowThumbnailSource(nodes: Node<NodeData>[]): string | null {
  for (const nodeType of THUMBNAIL_NODE_PRIORITY) {
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index];
      if (node.type !== nodeType) continue;
      const url = imageUrlForNode(node);
      if (url) return url;
    }
  }
  return null;
}

async function uploadThumbnail(
  payload: { flowId: string; sourceUrl?: string; dataUrl?: string },
): Promise<string> {
  const response = await fetch('/api/thumbnails/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Thumbnail upload failed with status ${response.status}`);
  }
  const { ref } = await response.json() as { ref?: string };
  if (!ref) throw new Error('Thumbnail upload returned no storage reference');
  return ref;
}

export async function createFlowThumbnail(
  nodes: Node<NodeData>[],
  flowId: string,
): Promise<string | null> {
  const sourceUrl = extractFlowThumbnailSource(nodes);
  if (!sourceUrl) return null;

  try {
    return await uploadThumbnail({ sourceUrl, flowId });
  } catch (serverError) {
    const dataUrl = await compressToThumbnailDataUrl(sourceUrl);
    if (!dataUrl) throw serverError;
    return uploadThumbnail({ dataUrl, flowId });
  }
}
