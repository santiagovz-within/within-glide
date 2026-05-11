'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Zap, Play } from 'lucide-react';
import { useState } from 'react';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle } from './TypedHandle';
import type { UpscaleNodeData } from '@/types';
import { UPSCALE_MODELS } from '@/lib/api/models';

export function UpscaleNode({ data, selected, id }: NodeProps & { data: UpscaleNodeData }) {
  const [isUpscaling, setIsUpscaling] = useState(false);

  function updateData(updates: Partial<UpscaleNodeData>) {
    document.dispatchEvent(new CustomEvent('node:update', {
      detail: { nodeId: id, data: updates },
    }));
  }

  async function handleUpscale() {
    if (!data.inputImageUrl || isUpscaling) return;
    setIsUpscaling(true);
    updateData({ status: 'processing' });

    try {
      const res = await fetch('/api/fal/upscale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: data.model,
          imageUrl: data.inputImageUrl,
          scaleFactor: data.scaleFactor,
          sourceType: 'canvas',
          nodeId: id,
        }),
      });
      const result = await res.json();

      if (result.mediaUrls?.[0]) {
        updateData({ outputImageUrl: result.mediaUrls[0], status: 'completed' });
      } else {
        updateData({ status: 'error' });
      }
    } catch {
      updateData({ status: 'error' });
    } finally {
      setIsUpscaling(false);
    }
  }

  return (
    <NodeWrapper
      title="Upscale"
      icon={<Zap size={14} />}
      status={data.status}
      selected={selected}
      minWidth={260}
    >
      <TypedHandle type="target" position={Position.Left} id="image" portType="image" />

      <div className="mb-2">
        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Model</label>
        <select
          className="w-full px-2 py-1.5 rounded-lg text-xs outline-none nodrag"
          value={data.model}
          onChange={(e) => updateData({ model: e.target.value })}
          style={{ background: 'var(--color-bg-surface)', border: 'var(--border-default)', color: 'var(--color-white)' }}
        >
          {UPSCALE_MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>

      <div className="mb-3">
        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Scale</label>
        <div className="flex gap-2">
          {[2, 4].map((scale) => (
            <button
              key={scale}
              onClick={() => updateData({ scaleFactor: scale })}
              className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors nodrag"
              style={{
                background: data.scaleFactor === scale ? 'var(--color-accent)' : 'var(--color-bg-surface)',
                color: data.scaleFactor === scale ? '#fff' : 'var(--color-white-muted)',
                border: 'var(--border-default)',
              }}
            >
              {scale}x
            </button>
          ))}
        </div>
      </div>

      {(data.inputImageUrl || data.outputImageUrl) && (
        <div className="grid grid-cols-2 gap-1 mb-3">
          {data.inputImageUrl && (
            <div>
              <p className="text-xs mb-1" style={{ color: 'var(--color-white-muted)' }}>Before</p>
              <div className="rounded-lg overflow-hidden" style={{ aspectRatio: '1' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={data.inputImageUrl} alt="Before" className="w-full h-full object-cover" />
              </div>
            </div>
          )}
          {data.outputImageUrl && (
            <div>
              <p className="text-xs mb-1" style={{ color: 'var(--color-white-muted)' }}>After</p>
              <div className="rounded-lg overflow-hidden" style={{ aspectRatio: '1' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={data.outputImageUrl} alt="After" className="w-full h-full object-cover" />
              </div>
            </div>
          )}
        </div>
      )}

      <button
        onClick={handleUpscale}
        disabled={isUpscaling || !data.inputImageUrl}
        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-opacity disabled:opacity-40 nodrag"
        style={{ background: 'var(--color-accent)', color: '#fff' }}
      >
        <Play size={12} />
        {isUpscaling ? 'Upscaling…' : 'Upscale'}
      </button>

      <TypedHandle type="source" position={Position.Right} id="image" portType="image" />
    </NodeWrapper>
  );
}
