'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { MonitorPlay, ImageIcon } from 'lucide-react';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle } from './TypedHandle';
import type { OutputNodeData, ImageInputNodeData, ImageGenNodeData, UpscaleNodeData, VideoGenNodeData } from '@/types';
import { downloadFromUrl } from '@/lib/utils/download';
import { useFlowStore } from '@/lib/stores/flowStore';

export function OutputNode({ data, selected, id }: NodeProps & { data: OutputNodeData }) {
  const storeEdges = useFlowStore(state => state.edges);
  const storeNodes = useFlowStore(state => state.nodes);

  const imageEdge = storeEdges.find(e => e.target === id && e.targetHandle === 'image');
  const videoEdge = storeEdges.find(e => e.target === id && e.targetHandle === 'video');
  const imgSource = imageEdge ? storeNodes.find(n => n.id === imageEdge.source) : undefined;
  const vidSource = videoEdge ? storeNodes.find(n => n.id === videoEdge.source) : undefined;

  function getImageUrl(node: typeof imgSource): string | undefined {
    if (!node) return undefined;
    if (node.type === 'imageInputNode') return (node.data as ImageInputNodeData).imageUrl;
    if (node.type === 'imageGenNode') return (node.data as ImageGenNodeData).generatedImages?.[0];
    if (node.type === 'upscaleNode') return (node.data as UpscaleNodeData).outputImageUrl;
    return undefined;
  }

  const videoUrl = vidSource ? (vidSource.data as VideoGenNodeData).videoUrl : undefined;
  const imageUrl = getImageUrl(imgSource);
  const mediaUrl = videoUrl ?? imageUrl ?? data.mediaUrl;
  const mediaType: 'image' | 'video' | undefined = videoUrl ? 'video' : imageUrl ? 'image' : data.mediaType;

  return (
    <NodeWrapper title="Output" icon={<MonitorPlay size={14} />} selected={selected} minWidth={280}>
      <TypedHandle type="target" position={Position.Left} id="image" portType="image" offset="40%" label="Image" />
      <TypedHandle type="target" position={Position.Left} id="video" portType="video" offset="65%" label="Video" />

      {mediaUrl ? (
        <div className="-m-3 overflow-hidden">
          {mediaType === 'video' ? (
            <video
              src={mediaUrl}
              controls
              className="w-full block"
              style={{ height: 'auto' }}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mediaUrl}
              alt="Output"
              className="w-full block cursor-pointer nodrag"
              style={{ height: 'auto' }}
              onClick={() => downloadFromUrl(mediaUrl)}
              title="Click to download"
            />
          )}
        </div>
      ) : (
        <div
          className="flex flex-col items-center justify-center gap-2"
          style={{
            height: 120,
            border: '1.5px dashed rgba(255,255,255,0.1)',
            borderRadius: '8px',
          }}
        >
          <ImageIcon size={24} className="opacity-20" style={{ color: 'var(--color-white)' }} />
          <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>
            Connect a node to preview output
          </p>
        </div>
      )}
    </NodeWrapper>
  );
}
