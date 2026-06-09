'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Zap, Play, Maximize2, Download } from 'lucide-react';
import { downloadFromUrl } from '@/lib/utils/download';
import { useEffect, useRef, useState } from 'react';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import type {
  UpscaleMediaNodeData,
  ImageInputNodeData, ImageGenNodeData, UpscaleNodeData, SelectNodeData,
  RemoveBgNodeData, ModifyNodeData, MediaInputNodeData,
  VideoGenNodeData, VideoInputNodeData, VideoUpscaleNodeData,
} from '@/types';
import { UPSCALE_MODELS, FAL_MODELS } from '@/lib/api/models';
import { ModelSelect } from './ModelSelect';
import { useFlowStore } from '@/lib/stores/flowStore';

type Dims = { w: number; h: number };

const VIDEO_SCALE_OPTIONS = [2, 3, 4];

// ── Comparison slider (image before/after) ────────────────────────────────────

function ComparisonSlider({ beforeUrl, afterUrl }: { beforeUrl: string; afterUrl: string }) {
  const [pct, setPct] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [beforeDims, setBeforeDims] = useState<Dims | null>(null);
  const [afterDims,  setAfterDims]  = useState<Dims | null>(null);

  const move = useRef((clientX: number) => {
    if (!containerRef.current) return;
    const { left, width } = containerRef.current.getBoundingClientRect();
    setPct(Math.max(0, Math.min(100, ((clientX - left) / width) * 100)));
  });

  useEffect(() => {
    const onMove = (e: MouseEvent) => { if (dragging.current) move.current(e.clientX); };
    const onUp   = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    };
  }, []);

  const dimLabel = (d: Dims | null) => d ? `${d.w}×${d.h}` : '';

  return (
    <>
      <div
        ref={containerRef}
        className="relative overflow-hidden select-none nodrag"
        style={{ cursor: 'col-resize' }}
        onMouseDown={(e) => { dragging.current = true; move.current(e.clientX); e.preventDefault(); }}
      >
        {/* After image — sets container height */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={afterUrl}
          alt="After"
          className="w-full block"
          style={{ height: 'auto' }}
          onLoad={(e) => { const img = e.currentTarget; setAfterDims({ w: img.naturalWidth, h: img.naturalHeight }); }}
        />
        {/* Before image — clipped overlay */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={beforeUrl}
          alt="Before"
          className="absolute inset-0 w-full h-full block"
          style={{ objectFit: 'cover', clipPath: `inset(0 ${100 - pct}% 0 0)` }}
          onLoad={(e) => { const img = e.currentTarget; setBeforeDims({ w: img.naturalWidth, h: img.naturalHeight }); }}
        />
        {/* Divider */}
        <div
          className="absolute top-0 bottom-0 w-0.5"
          style={{ left: `${pct}%`, background: 'rgba(255,255,255,0.9)', transform: 'translateX(-50%)', pointerEvents: 'none' }}
        >
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full flex items-center justify-center"
            style={{ width: 22, height: 22, background: '#fff', color: '#000' }}
          >
            <Maximize2 size={12} />
          </div>
        </div>
        <span className="absolute top-1.5 left-2 text-[10px] font-semibold" style={{ color: 'rgba(255,255,255,0.9)', textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>Before</span>
        <span className="absolute top-1.5 right-2 text-[10px] font-semibold" style={{ color: 'rgba(255,255,255,0.9)', textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>After</span>
      </div>
      <div className="flex justify-between px-1 pt-1" style={{ fontSize: 9, color: 'var(--color-white-muted)' }}>
        <span>{dimLabel(beforeDims)}</span>
        <span>{dimLabel(afterDims)}</span>
      </div>
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function UpscaleMediaNode({ data, selected, id }: NodeProps & { data: UpscaleMediaNodeData }) {
  const [isRunning, setIsRunning] = useState(false);
  const storeEdges = useFlowStore((state) => state.edges);
  const storeNodes = useFlowStore((state) => state.nodes);

  // ── Derive input from connected source ──────────────────────────────────────

  const incomingEdge  = storeEdges.find((e) => e.target === id && e.targetHandle === 'media');
  const sourceNode    = incomingEdge ? storeNodes.find((n) => n.id === incomingEdge.source) : undefined;
  const sourceHandle  = incomingEdge?.sourceHandle ?? null; // 'image' | 'video' | null

  // Treat the edge's source handle as the ground truth for media type — avoids
  // needing to enumerate every possible source node type.
  const inputMediaType: 'image' | 'video' | null = sourceHandle === 'video' ? 'video' : sourceHandle === 'image' ? 'image' : null;

  // Resolve the actual URL from the source node's data.
  let inputImageUrl: string | undefined;
  let inputVideoUrl: string | undefined;

  if (sourceNode && inputMediaType === 'image') {
    switch (sourceNode.type) {
      case 'imageInputNode':   inputImageUrl = (sourceNode.data as ImageInputNodeData).imageUrl; break;
      case 'mediaInputNode':   inputImageUrl = (sourceNode.data as MediaInputNodeData).imageUrl; break;
      case 'imageGenNode':     inputImageUrl = (sourceNode.data as ImageGenNodeData).generatedImages?.[0]; break;
      case 'upscaleNode':      inputImageUrl = (sourceNode.data as UpscaleNodeData).outputImageUrl; break;
      case 'upscaleMediaNode': inputImageUrl = (sourceNode.data as UpscaleMediaNodeData).outputImageUrl; break;
      case 'modifyNode':       inputImageUrl = (sourceNode.data as ModifyNodeData).outputImageUrl; break;
      case 'selectNode':       inputImageUrl = (sourceNode.data as SelectNodeData).selectedImageUrl; break;
      case 'removeBgNode':     inputImageUrl = (sourceNode.data as RemoveBgNodeData).outputImageUrl; break;
    }
  } else if (sourceNode && inputMediaType === 'video') {
    switch (sourceNode.type) {
      case 'videoGenNode':     inputVideoUrl = (sourceNode.data as VideoGenNodeData).videoUrl; break;
      case 'videoInputNode':   inputVideoUrl = (sourceNode.data as VideoInputNodeData).videoUrl; break;
      case 'mediaInputNode':   inputVideoUrl = (sourceNode.data as MediaInputNodeData).videoUrl; break;
      case 'videoUpscaleNode': inputVideoUrl = (sourceNode.data as VideoUpscaleNodeData).videoUrl; break;
      case 'upscaleMediaNode': inputVideoUrl = (sourceNode.data as UpscaleMediaNodeData).outputVideoUrl; break;
    }
  }

  // ── Clear stale output data and downstream edges when media type switches ───

  const prevInputMediaTypeRef = useRef<'image' | 'video' | null>(null);

  useEffect(() => {
    const prev = prevInputMediaTypeRef.current;
    if (prev !== null && prev !== inputMediaType) {
      // Remove downstream edges from the old output handle.
      const oldHandle = prev === 'image' ? 'image' : 'video';
      document.dispatchEvent(new CustomEvent('node:remove-source-edges', {
        detail: { nodeId: id, handleId: oldHandle },
      }));
      // Clear stale output from node data.
      document.dispatchEvent(new CustomEvent('node:update', {
        detail: {
          nodeId: id,
          data: prev === 'image'
            ? { outputImageUrl: undefined, status: 'idle' }
            : { outputVideoUrl: undefined, status: 'idle' },
        },
      }));
    }
    prevInputMediaTypeRef.current = inputMediaType;
  }, [inputMediaType, id]);

  // ── Image upscale settings ──────────────────────────────────────────────────

  const falModelConfig = FAL_MODELS[data.model as keyof typeof FAL_MODELS] as unknown as { scaleOptions?: number[] } | undefined;
  const scaleOptions: number[] = falModelConfig?.scaleOptions ?? [2, 4];
  const validScaleFactor = scaleOptions.includes(data.scaleFactor) ? data.scaleFactor : scaleOptions[scaleOptions.length - 1];

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function dispatchUpdate(updates: Partial<UpscaleMediaNodeData>) {
    document.dispatchEvent(new CustomEvent('node:update', { detail: { nodeId: id, data: updates } }));
  }

  function handleModelChange(model: string) {
    const cfg = FAL_MODELS[model as keyof typeof FAL_MODELS] as unknown as { scaleOptions?: number[] } | undefined;
    const opts: number[] = cfg?.scaleOptions ?? [2, 4];
    const clampedScale = opts.includes(data.scaleFactor) ? data.scaleFactor : opts[opts.length - 1];
    dispatchUpdate({ model, scaleFactor: clampedScale });
  }

  // ── Image upscale ───────────────────────────────────────────────────────────

  async function handleUpscaleImage() {
    if (!inputImageUrl || isRunning) return;
    setIsRunning(true);
    dispatchUpdate({ status: 'processing' });

    try {
      const res = await fetch('/api/fal/upscale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: data.model,
          imageUrl: inputImageUrl,
          scaleFactor: validScaleFactor,
          sourceType: 'canvas',
          nodeId: id,
        }),
      });
      const result = await res.json();
      if (result.mediaUrls?.[0]) {
        dispatchUpdate({ outputImageUrl: result.mediaUrls[0], status: 'completed' });
        document.dispatchEvent(new CustomEvent('node:image-propagate', {
          detail: { sourceNodeId: id, imageUrl: result.mediaUrls[0] },
        }));
      } else {
        dispatchUpdate({ status: 'error' });
      }
    } catch {
      dispatchUpdate({ status: 'error' });
    } finally {
      setIsRunning(false);
    }
  }

  // ── Video upscale ───────────────────────────────────────────────────────────

  async function handleUpscaleVideo() {
    if (!inputVideoUrl || isRunning) return;
    setIsRunning(true);
    dispatchUpdate({ status: 'processing' });

    try {
      const res = await fetch('/api/fal/video-upscale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: inputVideoUrl,
          upscaleFactor: data.upscaleFactor ?? 2,
          nodeId: id,
        }),
      });
      const result = await res.json();
      if (result.mediaUrls?.[0]) {
        dispatchUpdate({ outputVideoUrl: result.mediaUrls[0], status: 'completed' });
        document.dispatchEvent(new CustomEvent('node:video-propagate', {
          detail: { sourceNodeId: id, videoUrl: result.mediaUrls[0] },
        }));
        setIsRunning(false);
      } else if (result.requestId) {
        pollVideo(result.requestId);
      } else {
        dispatchUpdate({ status: 'error' });
        setIsRunning(false);
      }
    } catch {
      dispatchUpdate({ status: 'error' });
      setIsRunning(false);
    }
  }

  function pollVideo(requestId: string) {
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > 120) {
        clearInterval(interval);
        dispatchUpdate({ status: 'error' });
        setIsRunning(false);
        return;
      }
      try {
        const res = await fetch(`/api/fal/video-upscale/status/${requestId}`);
        const result = await res.json();
        if (result.status === 'completed' && result.mediaUrls?.[0]) {
          clearInterval(interval);
          dispatchUpdate({ outputVideoUrl: result.mediaUrls[0], status: 'completed' });
          document.dispatchEvent(new CustomEvent('node:video-propagate', {
            detail: { sourceNodeId: id, videoUrl: result.mediaUrls[0] },
          }));
          setIsRunning(false);
        } else if (result.status === 'failed') {
          clearInterval(interval);
          dispatchUpdate({ status: 'error' });
          setIsRunning(false);
        }
      } catch { /* keep polling */ }
    }, 5000);
  }

  // ── Derived display values ──────────────────────────────────────────────────

  const inputPortType  = inputMediaType === 'video' ? 'video' : inputMediaType === 'image' ? 'image' : 'neutral';
  const outputPortType = inputMediaType === 'video' ? 'video' : inputMediaType === 'image' ? 'image' : 'neutral';
  const outputHandleId = inputMediaType === 'video' ? 'video' : inputMediaType === 'image' ? 'image' : 'media';
  const accentColor    = inputMediaType === 'video' ? PORT_COLORS.video : inputMediaType === 'image' ? PORT_COLORS.image : PORT_COLORS.neutral;

  const upscaleFactor = data.upscaleFactor ?? 2;
  const hasImageOutput = inputMediaType === 'image' && !!data.outputImageUrl;
  const hasVideoOutput = inputMediaType === 'video' && !!data.outputVideoUrl;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <NodeWrapper
      title="Upscale Media"
      icon={<Zap size={14} />}
      status={data.status}
      selected={selected}
      minWidth={280}
      accentColor={accentColor}
    >
      <TypedHandle type="target" position={Position.Left} id="media" portType={inputPortType} />

      {/* ── No input connected ── */}
      {inputMediaType === null && (
        <div
          className="flex items-center justify-center rounded-lg mb-3"
          style={{ height: 52, background: 'var(--color-bg-surface)', border: '1px dashed rgba(255,255,255,0.12)', color: 'var(--color-white-muted)', fontSize: 12 }}
        >
          Connect an image or video to upscale
        </div>
      )}

      {/* ── Image mode: model + scale + preview ── */}
      {inputMediaType === 'image' && (
        <>
          <div className="mb-2">
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Model</label>
            <ModelSelect options={UPSCALE_MODELS} value={data.model} onChange={handleModelChange} />
          </div>

          <div className="mb-3">
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Scale</label>
            <div className="flex gap-1.5">
              {scaleOptions.map((scale) => (
                <button
                  key={scale}
                  onClick={() => dispatchUpdate({ scaleFactor: scale })}
                  className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors nodrag"
                  style={{
                    background: validScaleFactor === scale ? '#fff' : 'var(--color-bg-surface)',
                    color:      validScaleFactor === scale ? '#000' : 'var(--color-white-muted)',
                    border: 'var(--border-default)',
                  }}
                >
                  {scale}x
                </button>
              ))}
            </div>
          </div>

          {inputImageUrl && data.outputImageUrl ? (
            <div className="-mx-3 mb-3 overflow-hidden">
              <ComparisonSlider beforeUrl={inputImageUrl} afterUrl={data.outputImageUrl} />
            </div>
          ) : inputImageUrl ? (
            <div className="-mx-3 mb-3 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={inputImageUrl} alt="Input" className="w-full block" style={{ height: 'auto' }} />
            </div>
          ) : null}

          <button
            onClick={handleUpscaleImage}
            disabled={isRunning || !inputImageUrl}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-opacity disabled:opacity-40 nodrag"
            style={{ background: '#fff', color: '#000', borderRadius: 11 }}
          >
            <Play size={12} />
            {isRunning ? 'Upscaling…' : 'Upscale'}
          </button>

          {hasImageOutput && (
            <button
              onClick={() => downloadFromUrl(data.outputImageUrl!)}
              className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium mt-1.5 nodrag transition-opacity hover:opacity-80 active:opacity-60"
              style={{ background: 'var(--color-bg-surface)', color: 'var(--color-white-muted)', borderRadius: 11 }}
            >
              <Download size={12} />
              Download
            </button>
          )}
        </>
      )}

      {/* ── Video mode: scale factor + previews ── */}
      {inputMediaType === 'video' && (
        <>
          <div className="mb-3">
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Scale Factor</label>
            <div className="flex gap-1.5">
              {VIDEO_SCALE_OPTIONS.map((scale) => (
                <button
                  key={scale}
                  onClick={() => dispatchUpdate({ upscaleFactor: scale })}
                  className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors nodrag"
                  style={{
                    background: upscaleFactor === scale ? '#fff' : 'var(--color-bg-surface)',
                    color:      upscaleFactor === scale ? '#000' : 'var(--color-white-muted)',
                    border: 'var(--border-default)',
                  }}
                >
                  {scale}x
                </button>
              ))}
            </div>
          </div>

          {inputVideoUrl && (
            <div className="-mx-3 mb-3 overflow-hidden">
              <video src={inputVideoUrl} controls className="w-full block nodrag" style={{ height: 'auto' }} />
              <p className="px-3 pt-1 text-center" style={{ fontSize: 9, color: 'var(--color-white-muted)' }}>Input</p>
            </div>
          )}

          {hasVideoOutput && (
            <div className="-mx-3 mb-3 overflow-hidden">
              <video src={data.outputVideoUrl!} controls className="w-full block nodrag" style={{ height: 'auto' }} />
              <p className="px-3 pt-1 text-center" style={{ fontSize: 9, color: 'var(--color-white-muted)' }}>Output ({upscaleFactor}x)</p>
            </div>
          )}

          <button
            onClick={handleUpscaleVideo}
            disabled={isRunning || !inputVideoUrl}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-opacity disabled:opacity-40 nodrag"
            style={{ background: '#fff', color: '#000', borderRadius: 11 }}
          >
            <Play size={12} />
            {isRunning ? 'Upscaling…' : 'Upscale Video'}
          </button>

          {hasVideoOutput && (
            <button
              onClick={() => downloadFromUrl(data.outputVideoUrl!)}
              className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium mt-1.5 nodrag transition-opacity hover:opacity-80 active:opacity-60"
              style={{ background: 'var(--color-bg-surface)', color: 'var(--color-white-muted)', borderRadius: 11 }}
            >
              <Download size={12} />
              Download
            </button>
          )}
        </>
      )}

      <TypedHandle type="source" position={Position.Right} id={outputHandleId} portType={outputPortType} />
    </NodeWrapper>
  );
}
