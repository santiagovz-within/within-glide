'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Sliders, Play } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import type { ModifyNodeData } from '@/types';

const MODIFY_MODELS = [
  { id: 'nano-banana-2',   name: 'Nano Banana 2 Edit' },
  { id: 'nano-banana-pro', name: 'Nano Banana Pro Edit' },
];

const IMAGE_ROW_HEIGHT = 36;

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

export function ModifyNode({ data, selected, id }: NodeProps & { data: ModifyNodeData }) {
  const [isGenerating, setIsGenerating] = useState(false);
  const promptSectionRef = useRef<HTMLDivElement>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const imageRowRef = useRef<HTMLDivElement>(null);
  const [promptHandleTop, setPromptHandleTop] = useState(50);
  const [imageHandleTop, setImageHandleTop] = useState(130);

  useEffect(() => {
    if (promptTextareaRef.current) autoResize(promptTextareaRef.current);
  }, [data.prompt]);

  useLayoutEffect(() => {
    if (promptSectionRef.current) {
      const el = promptSectionRef.current;
      setPromptHandleTop(el.offsetTop + el.offsetHeight / 2);
    }
    if (imageRowRef.current) {
      setImageHandleTop(imageRowRef.current.offsetTop + IMAGE_ROW_HEIGHT / 2);
    }
  });

  function updateData(updates: Partial<ModifyNodeData>) {
    document.dispatchEvent(new CustomEvent('node:update', {
      detail: { nodeId: id, data: updates },
    }));
  }

  async function handleGenerate() {
    if (isGenerating || !data.inputImageUrl) return;
    setIsGenerating(true);
    updateData({ status: 'processing' });

    try {
      const res = await fetch('/api/fal/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: data.model,
          prompt: data.prompt ?? '',
          aspectRatio: '1:1',
          resolution: '1K',
          numImages: 1,
          referenceImageUrls: [data.inputImageUrl],
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
      setIsGenerating(false);
    }
  }

  return (
    <NodeWrapper
      title="Modify"
      icon={<Sliders size={14} />}
      status={data.status}
      selected={selected}
      minWidth={280}
      accentColor={PORT_COLORS.image}
    >
      <TypedHandle type="target" position={Position.Left} id="prompt" portType="text"  offset={`${promptHandleTop}px`} />
      <TypedHandle type="target" position={Position.Left} id="image"  portType="image" offset={`${imageHandleTop}px`}  />

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
            placeholder="Describe the changes…"
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

      {/* Image input slot */}
      <div
        ref={imageRowRef}
        className="flex items-center text-xs mb-3"
        style={{
          height: IMAGE_ROW_HEIGHT,
          marginLeft: -12,
          paddingLeft: 14,
          paddingRight: 8,
          borderRadius: '0 6px 6px 0',
          background: data.inputImageUrl ? '#3a1a6a' : 'var(--color-bg-surface)',
          border: data.inputImageUrl ? 'none' : '1px solid rgba(255,255,255,0.08)',
          borderLeft: 'none',
          color: data.inputImageUrl ? '#a855f7' : 'var(--color-white-muted)',
          transition: 'background 0.15s, color 0.15s',
        }}
      >
        Source Image
      </div>

      {/* Model selector */}
      <div className="mb-3">
        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Model</label>
        <select
          className="w-full px-2 py-1.5 rounded-lg text-xs outline-none nodrag"
          value={data.model}
          onChange={(e) => updateData({ model: e.target.value })}
          style={{ background: 'var(--color-bg-surface)', border: 'none', color: 'var(--color-white)', borderRadius: 11 }}
        >
          {MODIFY_MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>

      {/* Output preview */}
      {data.outputImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data.outputImageUrl}
          alt="Modified"
          className="w-full block rounded-lg mb-3 nodrag"
          style={{ height: 'auto' }}
        />
      )}

      <button
        onClick={handleGenerate}
        disabled={isGenerating || !data.inputImageUrl}
        className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-opacity disabled:opacity-40 nodrag"
        style={{ background: '#fff', color: '#000', borderRadius: 11 }}
      >
        <Play size={12} />
        {isGenerating ? 'Modifying…' : 'Modify'}
      </button>

      <TypedHandle type="source" position={Position.Right} id="image" portType="image" />
    </NodeWrapper>
  );
}
