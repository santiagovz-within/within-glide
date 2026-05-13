'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Monitor, Image, Download } from 'lucide-react';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
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
    <NodeWrapper title="Output" icon={<Monitor size={14} />} selected={selected} minWidth={280} accentColor="var(--color-white)">
      <TypedHandle type="target" position={Position.Left} id="image" portType="image" offset="40%" />
      <TypedHandle type="target" position={Position.Left} id="video" portType="video" offset="65%" />

      {mediaUrl ? (
        <>
          <div className="-mx-3 -mt-3 overflow-hidden" style={{ borderRadius: '14px 14px 0 0' }}>
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
                className="w-full block nodrag"
                style={{ height: 'auto' }}
              />
            )}
          </div>
          <button
            onClick={() => downloadFromUrl(mediaUrl)}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium mt-3 nodrag"
            style={{ background: 'var(--color-bg-surface)', color: 'var(--color-white-muted)', borderRadius: 11 }}
          >
            <Download size={12} />
            Download
          </button>
        </>
      ) : (
        <div
          className="flex flex-col items-center justify-center gap-2"
          style={{
            height: 120,
            border: '1.5px dashed rgba(255,255,255,0.1)',
            borderRadius: '8px',
          }}
        >
          <Image size={24} className="opacity-20" style={{ color: 'var(--color-white)' }} />
          <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>
            Connect a node to preview output
          </p>
        </div>
      )}
    </NodeWrapper>
  );
}
