'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Film, Play, AlertTriangle, Download } from 'lucide-react';
import { downloadFromUrl } from '@/lib/utils/download';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import type { VideoGenNodeData } from '@/types';
import { VIDEO_MODELS } from '@/lib/api/models';

const FRAME_ROW_HEIGHT = 36;
const FRAME_ROW_GAP = 25;

const KLING_ASPECT_RATIOS  = ['16:9', '9:16', '1:1'];
const SEEDANCE_ASPECT_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

export function VideoGenNode({ data, selected, id }: NodeProps & { data: VideoGenNodeData }) {
  const [isGenerating, setIsGenerating] = useState(false);
  const promptSectionRef = useRef<HTMLDivElement>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const startFrameRowRef = useRef<HTMLDivElement>(null);
  const endFrameRowRef = useRef<HTMLDivElement>(null);
  const [promptHandleTop, setPromptHandleTop] = useState(50);
  const [startFrameHandleTop, setStartFrameHandleTop] = useState(200);
  const [endFrameHandleTop, setEndFrameHandleTop] = useState(261);

  useEffect(() => {
    if (promptTextareaRef.current) autoResize(promptTextareaRef.current);
  }, [data.prompt]);

  const isKling     = data.model === 'kling-3-pro';
  const isSeedance  = data.model === 'seedance-2';
  const hasImage    = !!data.startFrameUrl;
  // Kling image-to-video: aspect ratio is determined by the input image
  const aspectLocked = isKling && hasImage;

  const aspectRatios = isSeedance ? SEEDANCE_ASPECT_RATIOS : KLING_ASPECT_RATIOS;

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
      const res = await fetch('/api/fal/generate', {
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

  // Derive video aspect ratio for the player — fall back to 16:9 if "custom"
  const videoAspect = aspectLocked ? '16/9' : data.aspectRatio.replace(':', '/');

  return (
    <NodeWrapper
      title="Video Generation"
      icon={<Film size={14} />}
      status={data.status}
      selected={selected}
      minWidth={300}
      accentColor={PORT_COLORS.video}
    >
      <TypedHandle type="target" position={Position.Left} id="prompt"      portType="text"  offset={`${promptHandleTop}px`}      />
      <TypedHandle type="target" position={Position.Left} id="start_frame" portType="image" offset={`${startFrameHandleTop}px`} />
      <TypedHandle type="target" position={Position.Left} id="end_frame"   portType="image" offset={`${endFrameHandleTop}px`}   />

      {/* Prompt */}
      <div ref={promptSectionRef} className="mb-3">
        {data.promptConnected ? (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium"
            style={{ background: 'rgba(59,158,255,0.1)', border: '1px solid rgba(59,158,255,0.25)', color: 'var(--color-accent)' }}
          >
            <span style={{ fontSize: 10 }}>T</span>
            Prompt connected
          </div>
        ) : (
          <textarea
            ref={promptTextareaRef}
            className="w-full text-xs outline-none nodrag"
            rows={2}
            placeholder="Write your prompt here…"
            value={data.prompt ?? ''}
            onChange={(e) => { autoResize(e.target); updateData({ prompt: e.target.value }); }}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-white)',
              resize: 'none',
              overflow: 'hidden',
              minHeight: 40,
            }}
          />
        )}
      </div>

      {/* Model selector */}
      <div className="mb-2">
        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Model</label>
        <select
          className="w-full px-2 py-1.5 rounded-lg text-xs outline-none nodrag"
          value={data.model}
          onChange={(e) => updateData({ model: e.target.value })}
          style={{ background: 'var(--color-bg-surface)', border: 'none', color: 'var(--color-white)', borderRadius: 11 }}
        >
          {VIDEO_MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>

      {isSeedance && (
        <div
          className="flex items-start gap-1.5 px-2 py-1.5 rounded-lg mb-2 text-xs nodrag"
          style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)', color: '#eab308' }}
        >
          <AlertTriangle size={11} className="shrink-0 mt-0.5" />
          This is a very expensive model to use, please use wisely.
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Aspect</label>
          {aspectLocked ? (
            <div
              className="w-full px-2 py-1.5 rounded-lg text-xs"
              style={{ background: 'var(--color-bg-surface)', border: 'var(--border-default)', color: 'var(--color-white-muted)' }}
            >
              Custom (from image)
            </div>
          ) : (
            <select
              className="w-full px-2 py-1.5 rounded-lg text-xs outline-none nodrag"
              value={data.aspectRatio}
              onChange={(e) => updateData({ aspectRatio: e.target.value })}
              style={{ background: 'var(--color-bg-surface)', border: 'none', color: 'var(--color-white)', borderRadius: 11 }}
            >
              {aspectRatios.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          )}
        </div>
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Duration</label>
          <select
            className="w-full px-2 py-1.5 rounded-lg text-xs outline-none nodrag"
            value={data.duration ?? 5}
            onChange={(e) => updateData({ duration: Number(e.target.value) })}
            style={{ background: 'var(--color-bg-surface)', border: 'none', color: 'var(--color-white)', borderRadius: 11 }}
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
        <video
          src={data.videoUrl}
          controls
          className="w-full block rounded-lg mb-3 nodrag"
          style={{ aspectRatio: videoAspect }}
        />
      )}

      <button
        onClick={handleGenerate}
        disabled={isGenerating}
        className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-opacity disabled:opacity-40 nodrag"
        style={{ background: '#fff', color: '#000', borderRadius: 11 }}
      >
        <Play size={12} />
        {isGenerating ? 'Generating…' : 'Generate'}
      </button>

      {data.videoUrl && (
        <button
          onClick={() => downloadFromUrl(data.videoUrl!)}
          className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium mt-1.5 nodrag"
          style={{ background: 'var(--color-bg-surface)', color: 'var(--color-white-muted)', borderRadius: 11 }}
        >
          <Download size={12} />
          Download
        </button>
      )}

      <TypedHandle type="source" position={Position.Right} id="video" portType="video" />
    </NodeWrapper>
  );
}
