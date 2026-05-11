'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { MonitorPlay, Download, ImageIcon } from 'lucide-react';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle } from './TypedHandle';
import type { OutputNodeData } from '@/types';

export function OutputNode({ data, selected }: NodeProps & { data: OutputNodeData }) {
  return (
    <NodeWrapper title="Output" icon={<MonitorPlay size={14} />} selected={selected} minWidth={260}>
      <TypedHandle type="target" position={Position.Left} id="image" portType="image" offset="40%" />
      <TypedHandle type="target" position={Position.Left} id="video" portType="video" offset="65%" />

      {data.mediaUrl ? (
        <div
          className="rounded-lg overflow-hidden relative group"
          style={{ width: '100%', aspectRatio: data.mediaType === 'video' ? '16/9' : 'auto', maxHeight: 240 }}
        >
          {data.mediaType === 'video' ? (
            <video src={data.mediaUrl} controls className="w-full h-full object-cover" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.mediaUrl} alt="Output" className="w-full h-auto object-contain" style={{ maxHeight: 240, display: 'block' }} />
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
