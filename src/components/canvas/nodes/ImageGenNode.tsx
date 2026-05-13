'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Wand2, Play } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { downloadFromUrl } from '@/lib/utils/download';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import type { ImageGenNodeData } from '@/types';
import { IMAGE_MODELS, FAL_MODELS } from '@/lib/api/models';
import { ASPECT_RATIOS } from '@/lib/utils/constants';

const RESOLUTIONS = ['1K', '2K', '4K'];
const MAX_REF_IMAGES = 14;
const REF_ROW_HEIGHT = 36;
const ROW_GAP = 25;

export function ImageGenNode({ data, selected, id }: NodeProps & { data: ImageGenNodeData }) {
  const [isGenerating, setIsGenerating] = useState(false);
  const promptSectionRef = useRef<HTMLDivElement>(null);
  const rowsListRef = useRef<HTMLDivElement>(null);
  const [promptHandleTop, setPromptHandleTop] = useState(50);
  const [rowsStartTop, setRowsStartTop] = useState(220);

  const modelConfig = IMAGE_MODELS.find((m) => m.id === data.model);
  const falConfig = FAL_MODELS[data.model as keyof typeof FAL_MODELS];

  // Multi-image: Google models OR fal models whose edit endpoint accepts image_urls[]
  const isMultiImageModel =
    modelConfig?.provider === 'google' ||
    (!!falConfig && 'editImageParam' in falConfig &&
      (falConfig as { editImageParam: string }).editImageParam === 'image_urls');

  const portCount = isMultiImageModel ? Math.max(data.imagePortCount ?? 1, 1) : 0;
  const connectedCount = (data.inputImageUrls ?? []).filter(Boolean).length;

  const hasEditVariant = !!falConfig && 'editEndpoint' in falConfig;
  const hasImageInput = (data.inputImageUrls ?? []).some(Boolean);
  const isEditMode = hasEditVariant && hasImageInput;

  // Measure the prompt section center for the text handle
  useLayoutEffect(() => {
    if (!promptSectionRef.current) return;
    const el = promptSectionRef.current;
    setPromptHandleTop(el.offsetTop + el.offsetHeight / 2);
  });

  // Measure the rows list (not the label) top for reference-image handle positions
  useLayoutEffect(() => {
    if (!isMultiImageModel || !rowsListRef.current) return;
    setRowsStartTop(rowsListRef.current.offsetTop);
  }, [isMultiImageModel, portCount, data.generatedImages?.length, data.status]);

  function updateData(updates: Partial<ImageGenNodeData>) {
    document.dispatchEvent(new CustomEvent('node:update', {
      detail: { nodeId: id, data: updates },
    }));
  }

  function handleModelChange(newModel: string) {
    const newFalConfig = FAL_MODELS[newModel as keyof typeof FAL_MODELS];
    const newConfig = IMAGE_MODELS.find((m) => m.id === newModel);
    const nowMulti =
      newConfig?.provider === 'google' ||
      (!!newFalConfig && 'editImageParam' in newFalConfig &&
        (newFalConfig as { editImageParam: string }).editImageParam === 'image_urls');
    if (isMultiImageModel !== nowMulti) {
      updateData({ model: newModel, inputImageUrls: [], imagePortCount: nowMulti ? 1 : 0 });
    } else {
      updateData({ model: newModel });
    }
  }

  async function handleGenerate() {
    if (isGenerating) return;
    setIsGenerating(true);
    updateData({ status: 'processing' });

    const endpoint = modelConfig?.provider === 'google' ? '/api/google/generate' : '/api/fal/generate';
    const inputImageUrls = (data.inputImageUrls ?? []).filter(Boolean);

    const payload = {
      model: data.model,
      prompt: data.prompt ?? '',
      aspectRatio: data.aspectRatio,
      resolution: data.resolution,
      numImages: data.numImages,
      referenceImageUrls: inputImageUrls,
      sourceType: 'canvas',
      nodeId: id,
    };
    console.log('[ImageGenNode] Outgoing payload →', JSON.stringify(payload, null, 2));

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      console.log('[ImageGenNode] API response ←', result);

      if (result.mediaUrls?.length) {
        updateData({ generatedImages: result.mediaUrls, status: 'completed' });
        document.dispatchEvent(new CustomEvent('node:image-propagate', {
          detail: { sourceNodeId: id, imageUrl: result.mediaUrls[0] },
        }));
      } else {
        updateData({ status: 'error' });
      }
    } catch (err) {
      console.error('[ImageGenNode] fetch error', err);
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
      accentColor={PORT_COLORS.image}
    >
      {/* ── Prompt handle aligned to center of prompt section ── */}
      <TypedHandle type="target" position={Position.Left} id="prompt" portType="text" offset={`${promptHandleTop}px`} />

      {/* ── Single reference-image handle (single-image models) ── */}
      {!isMultiImageModel && (
        <TypedHandle type="target" position={Position.Left} id="reference_image" portType="image" offset="55%" />
      )}

      {/* ── Dynamic multi-image handles aligned to row centers ─── */}
      {isMultiImageModel && Array.from({ length: portCount }, (_, i) => (
        <TypedHandle
          key={`ref_${i}`}
          type="target"
          position={Position.Left}
          id={`ref_${i}`}
          portType="image"
          offset={`${rowsStartTop + REF_ROW_HEIGHT / 2 + i * (REF_ROW_HEIGHT + ROW_GAP)}px`}
          badge={i + 1}
        />
      ))}

      {/* ── Inline prompt ────────────────────────────────────── */}
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
          <>
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>
              Prompt
            </label>
            <textarea
              className="w-full text-xs resize-y rounded-lg p-2 outline-none nodrag"
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
          </>
        )}
      </div>

      {/* ── Model selector ───────────────────────────────────── */}
      <div className="mb-3">
        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Model</label>
        <select
          className="w-full px-2 py-1.5 rounded-lg text-xs outline-none nodrag"
          value={data.model}
          onChange={(e) => handleModelChange(e.target.value)}
          style={{ background: 'var(--color-bg-surface)', border: 'var(--border-default)', color: 'var(--color-white)' }}
        >
          {IMAGE_MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>

      {/* ── Variant indicator (Fal models with edit endpoint) ─── */}
      {hasEditVariant && (
        <div className="flex items-center gap-1.5 mb-3 -mt-2">
          <div
            className="w-1.5 h-1.5 rounded-full transition-colors"
            style={{ background: isEditMode ? 'var(--color-accent)' : 'rgba(255,255,255,0.2)' }}
          />
          <span className="text-xs transition-colors" style={{ color: isEditMode ? 'var(--color-accent)' : 'var(--color-white-muted)' }}>
            {isEditMode ? 'Image-to-Image' : 'Text-to-Image'}
          </span>
        </div>
      )}

      {/* ── Aspect ratio + resolution ─────────────────────────── */}
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

      {/* ── Num images ───────────────────────────────────────── */}
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

      {/* ── Reference image rows (multi-image models) ──── */}
      {isMultiImageModel && (
        <div className="mb-3">
          <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>
            Reference Images{connectedCount > 0 ? ` (${connectedCount}/${MAX_REF_IMAGES})` : ''}
          </label>
          <div ref={rowsListRef}>
          {Array.from({ length: portCount }, (_, i) => {
            const hasImage = !!(data.inputImageUrls?.[i]);
            return (
              <div
                key={i}
                className="flex items-center text-xs"
                style={{
                  height: REF_ROW_HEIGHT,
                  marginLeft: -12,
                  paddingLeft: 14,
                  paddingRight: 8,
                  borderRadius: '0 6px 6px 0',
                  background: hasImage ? '#3a1a6a' : 'var(--color-bg-surface)',
                  border: hasImage ? 'none' : '1px solid rgba(255,255,255,0.08)',
                  borderLeft: 'none',
                  color: hasImage ? '#a855f7' : 'var(--color-white-muted)',
                  marginBottom: i < portCount - 1 ? ROW_GAP : 0,
                  transition: 'background 0.15s, color 0.15s',
                }}
              >
                Image {i + 1}
              </div>
            );
          })}
          </div>
        </div>
      )}

      {/* ── Generated previews ───────────────────────────────── */}
      {generatedImages.length > 0 && (
        <div
          className="-mx-3 mb-3"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.min(generatedImages.length, 2)}, 1fr)`,
            gap: '1px',
          }}
        >
          {generatedImages.map((url, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={url}
              alt={`Generated ${i + 1}`}
              className="w-full block cursor-pointer nodrag"
              style={{ height: 'auto' }}
              onClick={() => downloadFromUrl(url)}
              title="Click to download"
            />
          ))}
        </div>
      )}

      {/* ── Generate button ───────────────────────────────────── */}
      <button
        onClick={handleGenerate}
        disabled={isGenerating}
        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-opacity disabled:opacity-40 nodrag"
        style={{ background: '#fff', color: '#000' }}
      >
        <Play size={12} />
        {isGenerating ? 'Generating…' : 'Generate'}
      </button>

      <TypedHandle type="source" position={Position.Right} id="image" portType="image" />
    </NodeWrapper>
  );
}
