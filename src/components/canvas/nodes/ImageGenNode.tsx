'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Aperture, Play, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { downloadFromUrl } from '@/lib/utils/download';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import type { ImageGenNodeData } from '@/types';
import { IMAGE_MODELS, FAL_MODELS } from '@/lib/api/models';
import { ASPECT_RATIOS } from '@/lib/utils/constants';

const RESOLUTIONS = ['1K', '2K', '4K'];
const DEFAULT_MAX_REF_IMAGES = 14;
const REF_ROW_HEIGHT = 36;
const ROW_GAP = 25;

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

export function ImageGenNode({ data, selected, id }: NodeProps & { data: ImageGenNodeData }) {
  const [isGenerating, setIsGenerating] = useState(false);
  const genHistory = data.generationHistory ?? [];
  const [histIdx, setHistIdx] = useState(() => Math.max(0, genHistory.length - 1));
  const prevHistLen = useRef(genHistory.length);

  useEffect(() => {
    if (genHistory.length > prevHistLen.current) setHistIdx(genHistory.length - 1);
    prevHistLen.current = genHistory.length;
  }, [genHistory.length]);
  const promptSectionRef = useRef<HTMLDivElement>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const rowsListRef = useRef<HTMLDivElement>(null);
  const [promptHandleTop, setPromptHandleTop] = useState(50);
  const [rowsStartTop, setRowsStartTop] = useState(220);

  // Local prompt state prevents cursor-jump caused by Zustand→React re-renders
  // resetting a controlled textarea's cursor position.
  const [localPrompt, setLocalPrompt] = useState(() => data.prompt ?? '');
  const isFocused = useRef(false);
  useEffect(() => {
    if (!isFocused.current) setLocalPrompt(data.prompt ?? '');
  }, [data.prompt]);

  useEffect(() => {
    if (promptTextareaRef.current) autoResize(promptTextareaRef.current);
  }, [localPrompt]);

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
        const newHistory = [...(data.generationHistory ?? []), result.mediaUrls as string[]];
        updateData({ generatedImages: result.mediaUrls, generationHistory: newHistory, status: 'completed' });
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

  // What we display depends on which history entry is viewed
  const displayImages = genHistory.length > 0 ? (genHistory[histIdx] ?? []) : (data.generatedImages ?? []);

  return (
    <NodeWrapper
      title="Image Generation"
      icon={<Aperture size={14} />}
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
          <textarea
            ref={promptTextareaRef}
            className="w-full text-xs outline-none nodrag"
            rows={2}
            placeholder="Write your prompt here…"
            value={localPrompt}
            onFocus={() => { isFocused.current = true; }}
            onBlur={() => { isFocused.current = false; }}
            onChange={(e) => { const v = e.target.value; setLocalPrompt(v); autoResize(e.target); updateData({ prompt: v }); }}
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

      {/* ── Model selector ───────────────────────────────────── */}
      <div className="mb-3">
        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Model</label>
        <select
          className="w-full px-2 py-1.5 rounded-lg text-xs outline-none nodrag"
          value={data.model}
          onChange={(e) => handleModelChange(e.target.value)}
          style={{ background: 'var(--color-bg-surface)', border: 'none', color: 'var(--color-white)', borderRadius: 11 }}
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
            style={{ background: 'var(--color-bg-surface)', border: 'none', color: 'var(--color-white)', borderRadius: 11 }}
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
            style={{ background: 'var(--color-bg-surface)', border: 'none', color: 'var(--color-white)', borderRadius: 11 }}
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
            Reference Images{connectedCount > 0 ? ` (${connectedCount}/${modelConfig?.maxReferenceImages ?? DEFAULT_MAX_REF_IMAGES})` : ''}
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

      {/* ── Generation history navigation ─────────────────────── */}
      {genHistory.length > 1 && (
        <div className="flex items-center justify-between mb-1">
          <button
            onClick={() => setHistIdx(i => Math.max(0, i - 1))}
            disabled={histIdx === 0}
            className="flex items-center p-0.5 rounded transition-opacity disabled:opacity-30 nodrag"
            style={{ color: 'var(--color-white-muted)' }}
          >
            <ChevronLeft size={13} />
          </button>
          <span className="text-xs" style={{ color: histIdx < genHistory.length - 1 ? 'var(--color-accent)' : 'var(--color-white-muted)', fontSize: 10 }}>
            {`VERSION ${histIdx + 1}`}
          </span>
          <button
            onClick={() => setHistIdx(i => Math.min(genHistory.length - 1, i + 1))}
            disabled={histIdx === genHistory.length - 1}
            className="flex items-center p-0.5 rounded transition-opacity disabled:opacity-30 nodrag"
            style={{ color: 'var(--color-white-muted)' }}
          >
            <ChevronRight size={13} />
          </button>
        </div>
      )}

      {/* ── Generated previews ───────────────────────────────── */}
      {displayImages.length > 0 && (
        <div
          className="-mx-3 mb-3"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.min(displayImages.length, 2)}, 1fr)`,
            gap: '1px',
          }}
        >
          {displayImages.map((url, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={url}
              alt={`Generated ${i + 1}`}
              className="w-full block nodrag"
              style={{ height: 'auto' }}
            />
          ))}
        </div>
      )}

      {/* ── Generate button ───────────────────────────────────── */}
      <button
        onClick={handleGenerate}
        disabled={isGenerating}
        className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-opacity disabled:opacity-40 nodrag"
        style={{ background: '#fff', color: '#000', borderRadius: 11 }}
      >
        <Play size={12} />
        {isGenerating ? 'Generating…' : 'Generate'}
      </button>

      {displayImages.length > 0 && (
        <button
          onClick={() => downloadFromUrl(displayImages[0])}
          className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium mt-1.5 nodrag transition-opacity hover:opacity-80 active:opacity-60"
          style={{ background: 'var(--color-bg-surface)', color: 'var(--color-white-muted)', borderRadius: 11 }}
        >
          <Download size={12} />
          Download
        </button>
      )}

      <TypedHandle type="source" position={Position.Right} id="image" portType="image" />
    </NodeWrapper>
  );
}
