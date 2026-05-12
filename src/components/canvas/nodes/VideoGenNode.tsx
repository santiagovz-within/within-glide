'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Film, Play } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle } from './TypedHandle';
import type { VideoGenNodeData } from '@/types';
import { VIDEO_MODELS } from '@/lib/api/models';
import { ASPECT_RATIOS } from '@/lib/utils/constants';

const FRAME_ROW_HEIGHT = 36;
const FRAME_ROW_GAP = 25;

export function VideoGenNode({ data, selected, id }: NodeProps & { data: VideoGenNodeData }) {
  const [isGenerating, setIsGenerating] = useState(false);
  const promptSectionRef = useRef<HTMLDivElement>(null);
  const startFrameRowRef = useRef<HTMLDivElement>(null);
  const endFrameRowRef = useRef<HTMLDivElement>(null);
  const [promptHandleTop, setPromptHandleTop] = useState(50);
  const [startFrameHandleTop, setStartFrameHandleTop] = useState(200);
  const [endFrameHandleTop, setEndFrameHandleTop] = useState(261);

  useLayoutEffect(() => {
    if (!promptSectionRef.current) return;
    const el = promptSectionRef.current;
    setPromptHandleTop(el.offsetTop + el.offsetHeight / 2);
  });

  useLayoutEffect(() => {
    if (startFrameRowRef.current) {
      setStartFrameHandleTop(startFrameRowRef.current.offsetTop + FRAME_ROW_HEIGHT / 2);
    }
    if (endFrameRowRef.current) {
      setEndFrameHandleTop(endFrameRowRef.current.offsetTop + FRAME_ROW_HEIGHT / 2);
    }
  });

  function updateData(updates: Partial<VideoGenNodeData>) {
    document.dispatchEvent(new CustomEvent('node:update', {
      detail: { nodeId: id, data: updates },
    }));
  }

  async function handleGenerate() {
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
          prompt: data.prompt ?? '',
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
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > 100) {
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
      } catch { /* keep polling */ }
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
      <TypedHandle type="target" position={Position.Left} id="prompt"      portType="text"  offset={`${promptHandleTop}px`}      label="Prompt" />
      <TypedHandle type="target" position={Position.Left} id="start_frame" portType="image" offset={`${startFrameHandleTop}px`} label="Start Frame" />
      <TypedHandle type="target" position={Position.Left} id="end_frame"   portType="image" offset={`${endFrameHandleTop}px`}   label="End Frame" />

      {/* Inline prompt */}
      <div ref={promptSectionRef} className="mb-3">
        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>
          Prompt
        </label>
        <textarea
          className="w-full text-xs resize-y rounded-lg p-2 outline-none nodrag"
          rows={3}
          placeholder="Describe the video you want to generate…"
          value={data.prompt ?? ''}
          onChange={(e) => updateData({ prompt: e.target.value })}
          style={{
            background: 'var(--color-bg-surface)',
            border: 'var(--border-default)',
            color: 'var(--color-white)',
          }}
        />
      </div>

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

      {/* Frame reference slots */}
      <div className="mb-3">
        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Frame References</label>
        <div
          ref={startFrameRowRef}
          className="flex items-center text-xs"
          style={{
            height: FRAME_ROW_HEIGHT,
            marginLeft: -12,
            paddingLeft: 14,
            paddingRight: 8,
            borderRadius: '0 6px 6px 0',
            background: data.startFrameUrl ? '#3a1a6a' : 'var(--color-bg-surface)',
            border: data.startFrameUrl ? 'none' : '1px solid rgba(255,255,255,0.08)',
            borderLeft: 'none',
            color: data.startFrameUrl ? '#a855f7' : 'var(--color-white-muted)',
            marginBottom: FRAME_ROW_GAP,
            transition: 'background 0.15s, color 0.15s',
          }}
        >
          Start Frame
        </div>
        <div
          ref={endFrameRowRef}
          className="flex items-center text-xs"
          style={{
            height: FRAME_ROW_HEIGHT,
            marginLeft: -12,
            paddingLeft: 14,
            paddingRight: 8,
            borderRadius: '0 6px 6px 0',
            background: data.endFrameUrl ? '#3a1a6a' : 'var(--color-bg-surface)',
            border: data.endFrameUrl ? 'none' : '1px solid rgba(255,255,255,0.08)',
            borderLeft: 'none',
            color: data.endFrameUrl ? '#a855f7' : 'var(--color-white-muted)',
            transition: 'background 0.15s, color 0.15s',
          }}
        >
          End Frame
        </div>
      </div>

      {data.videoUrl && (
        <div className="-mx-3 mb-3" style={{ aspectRatio: data.aspectRatio.replace(':', '/'), maxHeight: 240 }}>
          <video src={data.videoUrl} controls className="w-full h-full object-cover" />
        </div>
      )}

      <button
        onClick={handleGenerate}
        disabled={isGenerating}
        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-opacity disabled:opacity-40 nodrag"
        style={{ background: '#fff', color: '#000' }}
      >
        <Play size={12} />
        {isGenerating ? 'Generating…' : 'Generate'}
      </button>

      <TypedHandle type="source" position={Position.Right} id="video" portType="video" label="Video" />
    </NodeWrapper>
  );
}
