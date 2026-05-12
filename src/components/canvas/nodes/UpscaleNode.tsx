'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Zap, Play, ChevronsLeftRight } from 'lucide-react';
import { useRef, useState } from 'react';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle } from './TypedHandle';
import type { UpscaleNodeData, ImageInputNodeData, ImageGenNodeData } from '@/types';
import { UPSCALE_MODELS, FAL_MODELS } from '@/lib/api/models';
import { useFlowStore } from '@/lib/stores/flowStore';

function ComparisonSlider({ beforeUrl, afterUrl }: { beforeUrl: string; afterUrl: string }) {
  const [pct, setPct] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  function move(clientX: number) {
    if (!containerRef.current) return;
    const { left, width } = containerRef.current.getBoundingClientRect();
    setPct(Math.max(0, Math.min(100, ((clientX - left) / width) * 100)));
  }

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden select-none nodrag"
      style={{ cursor: 'col-resize' }}
      onMouseDown={(e) => { dragging.current = true; move(e.clientX); }}
      onMouseMove={(e) => { if (dragging.current) move(e.clientX); }}
      onMouseUp={() => { dragging.current = false; }}
      onMouseLeave={() => { dragging.current = false; }}
    >
      {/* After image — base layer */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={afterUrl} alt="After" className="w-full block" style={{ height: 'auto' }} />

      {/* Before image — clipped overlay */}
      <div className="absolute inset-0 overflow-hidden" style={{ width: `${pct}%` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={beforeUrl}
          alt="Before"
          className="absolute top-0 left-0 block"
          style={{ width: containerRef.current?.offsetWidth ?? 'auto', height: '100%', objectFit: 'fill' }}
        />
      </div>

      {/* Divider */}
      <div
        className="absolute top-0 bottom-0 flex items-center justify-center"
        style={{ left: `${pct}%`, width: 2, background: 'rgba(255,255,255,0.9)', transform: 'translateX(-50%)', pointerEvents: 'none' }}
      >
        <div
          className="flex items-center justify-center rounded-full"
          style={{ width: 20, height: 20, background: '#fff', color: '#000', marginLeft: -9 }}
        >
          <ChevronsLeftRight size={12} />
        </div>
      </div>

      {/* Labels */}
      <span className="absolute bottom-1 left-2 text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.8)', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>Before</span>
      <span className="absolute bottom-1 right-2 text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.8)', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>After</span>
    </div>
  );
}

export function UpscaleNode({ data, selected, id }: NodeProps & { data: UpscaleNodeData }) {
  const [isUpscaling, setIsUpscaling] = useState(false);
  const storeEdges = useFlowStore(state => state.edges);
  const storeNodes = useFlowStore(state => state.nodes);

  // Derive input image directly from connected source node
  const incomingEdge = storeEdges.find(e => e.target === id && e.targetHandle === 'image');
  const sourceNode = incomingEdge ? storeNodes.find(n => n.id === incomingEdge.source) : undefined;
  let inputImageUrl: string | undefined;
  if (sourceNode?.type === 'imageInputNode') {
    inputImageUrl = (sourceNode.data as ImageInputNodeData).imageUrl;
  } else if (sourceNode?.type === 'imageGenNode') {
    inputImageUrl = (sourceNode.data as ImageGenNodeData).generatedImages?.[0];
  } else if (sourceNode?.type === 'upscaleNode') {
    inputImageUrl = (sourceNode.data as UpscaleNodeData).outputImageUrl;
  }

  // Scale options per model
  const falModelConfig = FAL_MODELS[data.model as keyof typeof FAL_MODELS] as unknown as { scaleOptions?: number[] } | undefined;
  const scaleOptions: number[] = falModelConfig?.scaleOptions ?? [2, 4];

  // If current scaleFactor is not valid for new model, clamp to max available
  const validScaleFactor = scaleOptions.includes(data.scaleFactor)
    ? data.scaleFactor
    : scaleOptions[scaleOptions.length - 1];

  function updateData(updates: Partial<UpscaleNodeData>) {
    document.dispatchEvent(new CustomEvent('node:update', {
      detail: { nodeId: id, data: updates },
    }));
  }

  function handleModelChange(model: string) {
    const newFalConfig = FAL_MODELS[model as keyof typeof FAL_MODELS] as unknown as { scaleOptions?: number[] } | undefined;
    const newOptions: number[] = newFalConfig?.scaleOptions ?? [2, 4];
    const clampedScale = newOptions.includes(data.scaleFactor)
      ? data.scaleFactor
      : newOptions[newOptions.length - 1];
    updateData({ model, scaleFactor: clampedScale });
  }

  async function handleUpscale() {
    if (!inputImageUrl || isUpscaling) return;
    setIsUpscaling(true);
    updateData({ status: 'processing' });

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
        updateData({ outputImageUrl: result.mediaUrls[0], status: 'completed' });
        document.dispatchEvent(new CustomEvent('node:image-propagate', {
          detail: { sourceNodeId: id, imageUrl: result.mediaUrls[0] },
        }));
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
      minWidth={280}
    >
      <TypedHandle type="target" position={Position.Left} id="image" portType="image" />

      <div className="mb-2">
        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Model</label>
        <select
          className="w-full px-2 py-1.5 rounded-lg text-xs outline-none nodrag"
          value={data.model}
          onChange={(e) => handleModelChange(e.target.value)}
          style={{ background: 'var(--color-bg-surface)', border: 'var(--border-default)', color: 'var(--color-white)' }}
        >
          {UPSCALE_MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>

      <div className="mb-3">
        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Scale</label>
        <div className="flex gap-1.5">
          {scaleOptions.map((scale) => (
            <button
              key={scale}
              onClick={() => updateData({ scaleFactor: scale })}
              className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors nodrag"
              style={{
                background: validScaleFactor === scale ? '#fff' : 'var(--color-bg-surface)',
                color: validScaleFactor === scale ? '#000' : 'var(--color-white-muted)',
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
        onClick={handleUpscale}
        disabled={isUpscaling || !inputImageUrl}
        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-opacity disabled:opacity-40 nodrag"
        style={{ background: '#fff', color: '#000' }}
      >
        <Play size={12} />
        {isUpscaling ? 'Upscaling…' : 'Upscale'}
      </button>

      <TypedHandle type="source" position={Position.Right} id="image" portType="image" />
    </NodeWrapper>
  );
}
