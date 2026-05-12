'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Handle } from '@xyflow/react';
import { LayoutGrid, Download, Film, ImageIcon } from 'lucide-react';
import { useFlowStore } from '@/lib/stores/flowStore';
import { NodeWrapper } from './NodeWrapper';
import { downloadFromUrl } from '@/lib/utils/download';
import type {
  GalleryOutputNodeData,
  ImageInputNodeData,
  ImageGenNodeData,
  UpscaleNodeData,
  VideoGenNodeData,
} from '@/types';

interface MediaItem {
  url: string;
  type: 'image' | 'video';
  sourceNodeId: string;
}

function getMediaFromNode(node: { type?: string; data: Record<string, unknown> }): MediaItem[] {
  if (node.type === 'imageInputNode') {
    const url = (node.data as ImageInputNodeData).imageUrl;
    return url ? [{ url, type: 'image', sourceNodeId: '' }] : [];
  }
  if (node.type === 'imageGenNode') {
    const imgs = (node.data as ImageGenNodeData).generatedImages ?? [];
    return imgs.map((url) => ({ url, type: 'image' as const, sourceNodeId: '' }));
  }
  if (node.type === 'upscaleNode') {
    const url = (node.data as UpscaleNodeData).outputImageUrl;
    return url ? [{ url, type: 'image', sourceNodeId: '' }] : [];
  }
  if (node.type === 'videoGenNode') {
    const url = (node.data as VideoGenNodeData).videoUrl;
    return url ? [{ url, type: 'video', sourceNodeId: '' }] : [];
  }
  return [];
}

async function downloadAll(items: MediaItem[]) {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const ext = item.type === 'video' ? 'mp4' : 'jpg';
    await downloadFromUrl(item.url, `gallery-${i + 1}.${ext}`);
    // small delay to avoid browser blocking multiple downloads
    await new Promise((r) => setTimeout(r, 300));
  }
}

export function GalleryOutputNode({ selected, id }: NodeProps & { data: GalleryOutputNodeData }) {
  const storeEdges = useFlowStore((state) => state.edges);
  const storeNodes = useFlowStore((state) => state.nodes);

  const incomingEdges = storeEdges.filter((e) => e.target === id);
  const mediaItems: MediaItem[] = incomingEdges.flatMap((edge) => {
    const sourceNode = storeNodes.find((n) => n.id === edge.source);
    if (!sourceNode) return [];
    return getMediaFromNode(sourceNode as { type?: string; data: Record<string, unknown> }).map((item) => ({
      ...item,
      sourceNodeId: edge.source,
    }));
  });

  return (
    <NodeWrapper
      title="Output Gallery"
      icon={<LayoutGrid size={14} />}
      selected={selected}
      minWidth={320}
      accentColor="#f59e0b"
    >
      {/* Wide hit-area target handle — accepts any connection type */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: '#1f1505',
          border: '1.5px solid #f59e0b',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#f59e0b',
          left: -44,
          transform: 'translateY(-50%)',
        }}
      >
        <LayoutGrid size={14} style={{ pointerEvents: 'none', color: '#f59e0b', position: 'absolute' }} />
      </Handle>

      {mediaItems.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center gap-2"
          style={{
            height: 120,
            border: '1.5px dashed rgba(245,158,11,0.2)',
            borderRadius: 8,
          }}
        >
          <LayoutGrid size={24} style={{ color: '#f59e0b', opacity: 0.3 }} />
          <p className="text-xs text-center" style={{ color: 'var(--color-white-muted)' }}>
            Connect image or video nodes to populate the gallery
          </p>
        </div>
      ) : (
        <>
          {/* Download all button */}
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>
              {mediaItems.length} asset{mediaItems.length !== 1 ? 's' : ''}
            </p>
            <button
              onClick={() => downloadAll(mediaItems)}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-opacity hover:opacity-80 nodrag"
              style={{ background: '#f59e0b', color: '#000' }}
              title="Download all"
            >
              <Download size={11} />
              Download All
            </button>
          </div>

          {/* Grid */}
          <div className="grid gap-1.5 nodrag" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))' }}>
            {mediaItems.map((item, i) => (
              <div
                key={`${item.sourceNodeId}-${i}`}
                className="relative rounded overflow-hidden cursor-pointer group"
                style={{ aspectRatio: '1 / 1', background: 'var(--color-bg-surface)' }}
                onClick={() => downloadFromUrl(item.url, `gallery-${i + 1}.${item.type === 'video' ? 'mp4' : 'jpg'}`)}
                title="Click to download"
              >
                {item.type === 'video' ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <div className="w-full h-full flex items-center justify-center" style={{ background: 'var(--color-bg-surface)' }}>
                      <Film size={20} style={{ color: 'var(--color-success)', opacity: 0.6 }} />
                    </div>
                  </>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.url}
                    alt={`Gallery ${i + 1}`}
                    className="w-full h-full object-cover"
                    draggable={false}
                  />
                )}
                {/* Hover overlay */}
                <div
                  className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: 'rgba(0,0,0,0.5)' }}
                >
                  {item.type === 'video'
                    ? <Film size={14} style={{ color: '#fff' }} />
                    : <ImageIcon size={14} style={{ color: '#fff' }} />
                  }
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </NodeWrapper>
  );
}
