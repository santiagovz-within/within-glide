'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { MonitorPlay, ImageIcon } from 'lucide-react';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle } from './TypedHandle';
import type { OutputNodeData } from '@/types';
import { downloadFromUrl } from '@/lib/utils/download';

export function OutputNode({ data, selected }: NodeProps & { data: OutputNodeData }) {
  return (
    <NodeWrapper title="Output" icon={<MonitorPlay size={14} />} selected={selected} minWidth={260}>
      <TypedHandle type="target" position={Position.Left} id="image" portType="image" offset="40%" />
      <TypedHandle type="target" position={Position.Left} id="video" portType="video" offset="65%" />

      {data.mediaUrl ? (
        <div className="rounded-lg overflow-hidden">
          {data.mediaType === 'video' ? (
            <video
              src={data.mediaUrl}
              controls
              className="w-full h-auto block"
              style={{ maxHeight: 260 }}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.mediaUrl}
              alt="Output"
              className="w-full h-auto block cursor-pointer"
              style={{ maxHeight: 300, objectFit: 'contain' }}
              onClick={() => downloadFromUrl(data.mediaUrl!)}
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
