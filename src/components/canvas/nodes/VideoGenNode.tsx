'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Film, Play } from 'lucide-react';
import { useState } from 'react';
import { NodeWrapper } from './NodeWrapper';
import type { VideoGenNodeData } from '@/types';
import { VIDEO_MODELS } from '@/lib/api/models';
import { ASPECT_RATIOS } from '@/lib/utils/constants';

export function VideoGenNode({ data, selected, id }: NodeProps & { data: VideoGenNodeData }) {
  const [isGenerating, setIsGenerating] = useState(false);

  function updateData(updates: Partial<VideoGenNodeData>) {
    const event = new CustomEvent('node:update', {
      detail: { nodeId: id, data: updates },
    });
    document.dispatchEvent(event);
  }

  async function handleGenerate() {
    if (!data.prompt) return;
    if (isGenerating) return;
    setIsGenerating(true);
    updateData({ status: 'processing' });

    try {
      const endpoint = data.model === 'veo-3.1' ? '/api/google/veo' : '/api/fal/generate';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: data.model,
          prompt: data.prompt,
          aspectRatio: data.aspectRatio,
          duration: data.duration,
          startFrameUrl: data.startFrameUrl,
          endFrameUrl: data.endFrameUrl,
          sourceType: 'canvas',
          nodeId: id,
        }),
      });
      const result = await res.json();

      if (result.mediaUrls?.[0]) {
        updateData({ videoUrl: result.mediaUrls[0], status: 'completed' });
      } else if (result.requestId) {
        // Poll for async result
        pollForResult(result.requestId);
      } else {
        updateData({ status: 'error' });
      }
    } catch {
      updateData({ status: 'error' });
      setIsGenerating(false);
    }
  }

  async function pollForResult(requestId: string) {
    const maxAttempts = 100;
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(interval);
        updateData({ status: 'error' });
        setIsGenerating(false);
        return;
      }
      try {
        const res = await fetch(`/api/fal/status/${requestId}`);
        const result = await res.json();
        if (result.status === 'completed' && result.mediaUrls?.[0]) {
          clearInterval(interval);
          updateData({ videoUrl: result.mediaUrls[0], status: 'completed' });
          setIsGenerating(false);
        } else if (result.status === 'failed') {
          clearInterval(interval);
          updateData({ status: 'error' });
          setIsGenerating(false);
        }
      } catch {
        // keep polling
      }
    }, 3000);
  }

  return (
    <NodeWrapper
      title="Video Generation"
      icon={<Film size={14} />}
      status={data.status}
      selected={selected}
      minWidth={300}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="prompt"
        style={{ top: '30%', background: 'var(--color-accent)', border: '2px solid var(--color-bg-elevated)', width: 10, height: 10 }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="start_frame"
        style={{ top: '55%', background: 'var(--color-white-muted)', border: '2px solid var(--color-bg-elevated)', width: 10, height: 10 }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="end_frame"
        style={{ top: '75%', background: 'var(--color-white-muted)', border: '2px solid var(--color-bg-elevated)', width: 10, height: 10 }}
      />

      {/* Model selector */}
      <div className="mb-2">
        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Model</label>
        <select
          className="w-full px-2 py-1.5 rounded-lg text-xs outline-none nodrag"
          value={data.model}
          onChange={(e) => updateData({ model: e.target.value })}
          style={{ background: 'var(--color-bg-surface)', border: 'var(--border-default)', color: 'var(--color-white)' }}
        >
          {VIDEO_MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Aspect</label>
          <select
            className="w-full px-2 py-1.5 rounded-lg text-xs outline-none nodrag"
            value={data.aspectRatio}
            onChange={(e) => updateData({ aspectRatio: e.target.value })}
            style={{ background: 'var(--color-bg-surface)', border: 'var(--border-default)', color: 'var(--color-white)' }}
          >
            {ASPECT_RATIOS.slice(0, 3).map((r) => (
              <option key={r.value} value={r.value}>{r.value}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Duration</label>
          <select
            className="w-full px-2 py-1.5 rounded-lg text-xs outline-none nodrag"
            value={data.duration ?? 5}
            onChange={(e) => updateData({ duration: Number(e.target.value) })}
            style={{ background: 'var(--color-bg-surface)', border: 'var(--border-default)', color: 'var(--color-white)' }}
          >
            <option value={3}>3s</option>
            <option value={5}>5s</option>
            <option value={8}>8s</option>
            <option value={10}>10s</option>
          </select>
        </div>
      </div>

      {/* Video preview */}
      {data.videoUrl && (
        <div className="mb-3 rounded-lg overflow-hidden" style={{ aspectRatio: '16/9' }}>
          <video src={data.videoUrl} controls className="w-full h-full object-cover" />
        </div>
      )}

      <button
        onClick={handleGenerate}
        disabled={isGenerating || !data.prompt}
        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-opacity disabled:opacity-40 nodrag"
        style={{ background: 'var(--color-accent)', color: '#fff' }}
      >
        <Play size={12} />
        {isGenerating ? 'Generating...' : 'Generate'}
      </button>

      <Handle
        type="source"
        position={Position.Right}
        id="video"
        style={{ background: 'var(--color-accent)', border: '2px solid var(--color-bg-elevated)', width: 10, height: 10 }}
      />
    </NodeWrapper>
  );
}
