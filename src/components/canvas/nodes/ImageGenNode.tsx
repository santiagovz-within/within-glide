'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Wand2, Play, Download } from 'lucide-react';
import { useState } from 'react';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle } from './TypedHandle';
import type { ImageGenNodeData } from '@/types';
import { IMAGE_MODELS } from '@/lib/api/models';
import { ASPECT_RATIOS } from '@/lib/utils/constants';

const RESOLUTIONS = ['1K', '2K', '4K'];

export function ImageGenNode({ data, selected, id }: NodeProps & { data: ImageGenNodeData }) {
  const [isGenerating, setIsGenerating] = useState(false);

  function updateData(updates: Partial<ImageGenNodeData>) {
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
          resolution: data.resolution,
          numImages: data.numImages,
          referenceImageUrls: data.referenceImageUrl ? [data.referenceImageUrl] : [],
          sourceType: 'canvas',
          nodeId: id,
        }),
      });
      const result = await res.json();

      if (result.mediaUrls?.length) {
        updateData({ generatedImages: result.mediaUrls, status: 'completed' });
      } else {
        updateData({ status: 'error' });
      }
    } catch {
      updateData({ status: 'error' });
    } finally {
      setIsGenerating(false);
    }
  }

  const generatedImages = data.generatedImages ?? [];

  return (
    <NodeWrapper
      title="Image Generation"
      icon={<Wand2 size={14} />}
      status={data.status}
      selected={selected}
      minWidth={300}
    >
      {/* Input handles — positioned relative to the node card */}
      <TypedHandle type="target" position={Position.Left} id="prompt"           portType="text"  offset="30%" />
      <TypedHandle type="target" position={Position.Left} id="reference_image"  portType="image" offset="58%" />

      {/* Inline prompt — editable directly or populated by a connected PromptNode */}
      <div className="mb-3">
        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>
          Prompt
        </label>
        <textarea
          className="w-full text-xs resize-none rounded-lg p-2 outline-none nodrag"
          rows={3}
          placeholder="Describe what you want to generate…"
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
      <div className="mb-3">
        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Model</label>
        <select
          className="w-full px-2 py-1.5 rounded-lg text-xs outline-none nodrag"
          value={data.model}
          onChange={(e) => updateData({ model: e.target.value })}
          style={{ background: 'var(--color-bg-surface)', border: 'var(--border-default)', color: 'var(--color-white)' }}
        >
          {IMAGE_MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>

      {/* Aspect ratio + resolution */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Aspect</label>
          <select
            className="w-full px-2 py-1.5 rounded-lg text-xs outline-none nodrag"
            value={data.aspectRatio}
            onChange={(e) => updateData({ aspectRatio: e.target.value })}
            style={{ background: 'var(--color-bg-surface)', border: 'var(--border-default)', color: 'var(--color-white)' }}
          >
            {ASPECT_RATIOS.map((r) => (
              <option key={r.value} value={r.value}>{r.value}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Resolution</label>
          <select
            className="w-full px-2 py-1.5 rounded-lg text-xs outline-none nodrag"
            value={data.resolution}
            onChange={(e) => updateData({ resolution: e.target.value })}
            style={{ background: 'var(--color-bg-surface)', border: 'var(--border-default)', color: 'var(--color-white)' }}
          >
            {RESOLUTIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Num images */}
      <div className="mb-3">
        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>
          Images: {data.numImages}
        </label>
        <input
          type="range" min={1} max={4} value={data.numImages}
          onChange={(e) => updateData({ numImages: Number(e.target.value) })}
          className="w-full nodrag"
          style={{ accentColor: 'var(--color-accent)' }}
        />
      </div>

      {/* Generated previews */}
      {generatedImages.length > 0 && (
        <div
          className="mb-3 grid gap-1"
          style={{ gridTemplateColumns: `repeat(${Math.min(generatedImages.length, 2)}, 1fr)` }}
        >
          {generatedImages.map((url, i) => (
            <div key={i} className="relative rounded-lg overflow-hidden group" style={{ aspectRatio: '1' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Generated ${i + 1}`} className="w-full h-full object-cover" />
              <a
                href={url} download
                className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity nodrag"
                onClick={(e) => e.stopPropagation()}
              >
                <Download size={14} style={{ color: 'var(--color-white)' }} />
              </a>
            </div>
          ))}
        </div>
      )}

      {/* Generate button — only disabled while a request is in-flight */}
      <button
        onClick={handleGenerate}
        disabled={isGenerating}
        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-opacity disabled:opacity-40 nodrag"
        style={{ background: 'var(--color-accent)', color: '#fff' }}
      >
        <Play size={12} />
        {isGenerating ? 'Generating…' : 'Generate'}
      </button>

      <TypedHandle type="source" position={Position.Right} id="image" portType="image" />
    </NodeWrapper>
  );
}
