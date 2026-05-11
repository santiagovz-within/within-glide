'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { MonitorPlay, Download, ImageIcon } from 'lucide-react';
import { NodeWrapper } from './NodeWrapper';
import type { OutputNodeData } from '@/types';

export function OutputNode({ data, selected }: NodeProps & { data: OutputNodeData }) {
  return (
    <NodeWrapper title="Output" icon={<MonitorPlay size={14} />} selected={selected} minWidth={260}>
      <Handle
        type="target"
        position={Position.Left}
        id="image"
        style={{ top: '40%', background: 'var(--color-accent)', border: '2px solid var(--color-bg-elevated)', width: 10, height: 10 }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="video"
        style={{ top: '65%', background: 'var(--color-accent)', border: '2px solid var(--color-bg-elevated)', width: 10, height: 10 }}
      />

      {data.mediaUrl ? (
        <div className="rounded-lg overflow-hidden relative group" style={{ aspectRatio: data.mediaType === 'video' ? '16/9' : '1' }}>
          {data.mediaType === 'video' ? (
            <video src={data.mediaUrl} controls className="w-full h-full object-cover" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.mediaUrl} alt="Output" className="w-full h-full object-cover" />
          )}
          <a
            href={data.mediaUrl}
            download
            className="absolute top-2 right-2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ background: 'rgba(0,0,0,0.6)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <Download size={12} style={{ color: 'var(--color-white)' }} />
          </a>
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
