'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Aperture, Play, Download, ChevronLeft, ChevronRight, Image as ImageIcon, RefreshCw } from 'lucide-react';
import { SendToFigmaButton } from './SendToFigmaButton';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { downloadAllFromUrls } from '@/lib/utils/download';
import { playSuccessSound } from '@/lib/utils/sound';
import { ProgressiveImage } from '@/components/ui/ProgressiveImage';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import type { ImageGenNodeData } from '@/types';
import { IMAGE_MODELS, FAL_MODELS } from '@/lib/api/models';
import { ModelSelect } from './ModelSelect';
import { NodeSelect } from './NodeSelect';
import { ASPECT_RATIOS } from '@/lib/utils/constants';
import { useFlowStore } from '@/lib/stores/flowStore';

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
  const [isDownloading, setIsDownloading] = useState(false);
  const isOutputConnected = useFlowStore((s) => s.edges.some((e) => e.source === id && e.sourceHandle === 'image'));
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

  const isMultiImageModel =
    modelConfig?.provider === 'google' ||
    (!!falConfig && 'editImageParam' in falConfig &&
      (falConfig as { editImageParam: string }).editImageParam === 'image_urls');

  const portCount = isMultiImageModel ? Math.max(data.imagePortCount ?? 1, 1) : 0;
  const connectedCount = (data.inputImageUrls ?? []).filter(Boolean).length;

  const hasEditVariant = !!falConfig && 'editEndpoint' in falConfig;
  const hasImageInput = (data.inputImageUrls ?? []).some(Boolean);
  const isEditMode = hasEditVariant && hasImageInput;

  useLayoutEffect(() => {
    if (!promptSectionRef.current) return;
    const el = promptSectionRef.current;
    setPromptHandleTop(el.offsetTop + el.offsetHeight / 2);
  });

  useLayoutEffect(() => {
    if (!isMultiImageModel || !rowsListRef.current) return;
    setRowsStartTop(rowsListRef.current.offsetTop);
  }, [isMultiImageModel, portCount, data.generatedImages?.length, data.status]);

  function updateData(updates: Partial<ImageGenNodeData>) {
    document.dispatchEvent(new CustomEvent('node:update', {
      detail: { nodeId: id, data: updates },
    }));
  }

  function navigateHistory(idx: number) {
    setHistIdx(idx);
    const images = genHistory[idx] ?? [];
    useFlowStore.getState().updateNodeData(id, { generatedImages: images });
    if (images[0]) {
      document.dispatchEvent(new CustomEvent('node:image-propagate', {
        detail: { sourceNodeId: id, imageUrl: images[0] },
      }));
    }
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
        updateData({ generatedImages: result.mediaUrls, generationHistory: newHistory, status: 'completed', errorMessage: undefined });
        playSuccessSound();
        document.dispatchEvent(new CustomEvent('node:image-propagate', {
          detail: { sourceNodeId: id, imageUrl: result.mediaUrls[0] },
        }));
      } else {
        updateData({ status: 'error', errorMessage: result.details ?? result.error ?? 'Image generation failed — no output returned.' });
      }
    } catch (err) {
      console.error('[ImageGenNode] fetch error', err);
      updateData({ status: 'error', errorMessage: err instanceof Error ? err.message : 'Network error — check your connection.' });
    } finally {
      setIsGenerating(false);
    }
  }

  const displayImages = genHistory.length > 0 ? (genHistory[histIdx] ?? []) : (data.generatedImages ?? []);

  async function handleDownload() {
    if (isDownloading || displayImages.length === 0) return;
    setIsDownloading(true);
    try {
      await downloadAllFromUrls(displayImages, `image-generation-v${histIdx + 1}`);
    } finally {
      setIsDownloading(false);
    }
  }

  const sliderPct = ((data.numImages - 1) / 3) * 100;

  const footer = (
    <div className="flex flex-col gap-2">
      <button
        onClick={handleGenerate}
        disabled={isGenerating}
        className="w-full flex items-center justify-center gap-1.5 py-3 text-xs font-medium transition-opacity disabled:opacity-40 nodrag"
        style={{ background: 'var(--action-btn-bg)', color: 'var(--action-btn-color)', borderRadius: 11 }}
      >
        <Play size={12} />
        {isGenerating ? 'Generating…' : 'Generate'}
      </button>
      {displayImages.length > 0 && (
        <div key={displayImages[0]} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <button
            onClick={handleDownload}
            disabled={isDownloading}
            className="flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-medium nodrag transition-opacity hover:opacity-80 active:opacity-60 disabled:opacity-50"
            style={{ background: 'var(--color-bg-surface)', color: 'var(--color-white-muted)', borderRadius: 11 }}
          >
            {isDownloading ? <RefreshCw size={12} className="animate-spin" /> : <Download size={12} />}
            {isDownloading ? 'Downloading…' : displayImages.length > 1 ? `Download All (${displayImages.length})` : 'Download'}
          </button>
          <SendToFigmaButton imageUrl={displayImages[0]} style={{ flex: 1, minWidth: 0 }} />
        </div>
      )}
    </div>
  );

  return (
    <NodeWrapper
      title="Image Generation"
      icon={<Aperture size={14} />}
      status={data.status}
      errorMessage={data.errorMessage}
      selected={selected}
      minWidth={300}
      accentColor={PORT_COLORS.image}
      titlePosition="outside"
      footer={footer}
    >
      {/* ── Handles ─────────────────────────────────────────── */}
      <TypedHandle
        type="target"
        position={Position.Left}
        id="prompt"
        portType="text"
        offset={`${promptHandleTop}px`}
        connected={!!data.promptConnected}
      />

      {!isMultiImageModel && (
        <TypedHandle
          type="target"
          position={Position.Left}
          id="reference_image"
          portType="image"
          offset="55%"
          connected={!!(data.inputImageUrls?.[0])}
        />
      )}

      {isMultiImageModel && Array.from({ length: portCount }, (_, i) => (
        <TypedHandle
          key={`ref_${i}`}
          type="target"
          position={Position.Left}
          id={`ref_${i}`}
          portType="image"
          offset={`${rowsStartTop + REF_ROW_HEIGHT / 2 + i * (REF_ROW_HEIGHT + ROW_GAP)}px`}
          badge={i + 1}
          connected={!!(data.inputImageUrls?.[i])}
        />
      ))}

      {/* ── Inline prompt ────────────────────────────────────── */}
      <div ref={promptSectionRef} className="mb-3">
        {data.promptConnected ? (
          <div
            className="flex items-center gap-2 px-3 rounded-lg text-xs font-medium"
            style={{ height: REF_ROW_HEIGHT, background: '#3999F8', color: '#fff' }}
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
        <ModelSelect options={IMAGE_MODELS} value={data.model} onChange={handleModelChange} />
      </div>

      {/* ── Image-to-image / Text-to-image badge ─────────────── */}
      {hasEditVariant && (
        <div className="mb-3" style={{ marginTop: -6 }}>
          <div
            className="inline-flex items-center gap-1.5"
            style={{
              padding: '3px 10px 5px 10px',
              borderRadius: 8,
              background: isEditMode ? 'var(--tag-image-bg)' : 'var(--color-white-subtle)',
              transition: 'background 0.15s',
            }}
          >
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: isEditMode ? 'var(--tag-image-dot)' : 'var(--color-white-muted)',
                transition: 'background 0.15s',
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: 10,
                fontWeight: 500,
                color: isEditMode ? 'var(--tag-image-text)' : 'var(--color-white-muted)',
                transition: 'color 0.15s',
              }}
            >
              {isEditMode ? 'Image-to-image' : 'Text-to-image'}
            </span>
          </div>
        </div>
      )}

      {/* ── Aspect ratio + resolution ─────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Aspect</label>
          <NodeSelect
            options={ASPECT_RATIOS.map((r) => r.value)}
            value={data.aspectRatio}
            onChange={(v) => updateData({ aspectRatio: v })}
          />
        </div>
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Resolution</label>
          <NodeSelect
            options={RESOLUTIONS}
            value={data.resolution}
            onChange={(v) => updateData({ resolution: v })}
          />
        </div>
      </div>

      {/* ── Images to generate slider ─────────────────────────── */}
      <div className="mb-3">
        <label className="text-xs font-medium block mb-3" style={{ color: 'var(--color-white-muted)' }}>
          Images to generate: {data.numImages}
        </label>
        {/* Custom slider: track + ticks + thumb, native input on top for interaction */}
        <div className="relative nodrag" style={{ height: 24 }}>
          {/* Track */}
          <div
            style={{
              position: 'absolute',
              left: 0, right: 0,
              top: '50%',
              height: 4,
              transform: 'translateY(-50%)',
              borderRadius: 2,
              background: `linear-gradient(to right, #a855f7 ${sliderPct}%, rgba(255,255,255,0.12) ${sliderPct}%)`,
            }}
          >
            {/* Tick marks at each step value */}
            {[0, 1, 2, 3].map((i) => {
              const tickPct = (i / 3) * 100;
              const isThumb = i === data.numImages - 1;
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: i < data.numImages ? '#a855f7' : '#4a4a4f',
                    top: '50%',
                    left: `${tickPct}%`,
                    transform: 'translate(-50%, -50%)',
                    opacity: isThumb ? 0 : 1,
                  }}
                />
              );
            })}
          </div>
          {/* Thumb */}
          <div
            style={{
              position: 'absolute',
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: '#a855f7',
              top: '50%',
              left: `${sliderPct}%`,
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'none',
            }}
          />
          {/* Invisible native input for interaction */}
          <input
            type="range" min={1} max={4} step={1} value={data.numImages}
            onChange={(e) => updateData({ numImages: Number(e.target.value) })}
            className="absolute inset-0 w-full opacity-0 cursor-pointer nodrag"
            style={{ height: '100%', margin: 0 }}
          />
        </div>
      </div>

      {/* ── Reference image rows (multi-image models) ──────────── */}
      {isMultiImageModel && (
        <div className="mb-3">
          <label className="text-xs font-medium block mb-2" style={{ color: 'var(--color-white-muted)' }}>
            Reference Images{connectedCount > 0 ? ` (${connectedCount} / ${modelConfig?.maxReferenceImages ?? DEFAULT_MAX_REF_IMAGES})` : ''}
          </label>
          <div ref={rowsListRef} className="flex flex-col" style={{ gap: ROW_GAP }}>
            {Array.from({ length: portCount }, (_, i) => {
              const hasImage = !!(data.inputImageUrls?.[i]);
              return (
                <div
                  key={i}
                  className="flex items-center gap-2 text-xs font-medium"
                  style={{
                    height: REF_ROW_HEIGHT,
                    paddingLeft: 12,
                    paddingRight: 12,
                    borderRadius: '4px 16px 16px 4px',
                    background: hasImage ? '#a855f7' : 'var(--color-bg-surface)',
                    color: hasImage ? '#fff' : 'var(--color-white-muted)',
                    transition: 'background 0.15s, color 0.15s',
                  }}
                >
                  <ImageIcon size={12} style={{ flexShrink: 0 }} />
                  Image {i + 1}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Generation history navigation ─────────────────────── */}
      {genHistory.length > 1 && (
        <div className="flex items-center justify-between my-1.5">
          <button
            onClick={() => navigateHistory(Math.max(0, histIdx - 1))}
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
            onClick={() => navigateHistory(Math.min(genHistory.length - 1, histIdx + 1))}
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
        <div className="flex flex-col gap-2">
          {displayImages.map((url, i) => (
            <div
              key={i}
              style={{
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.08)',
                overflow: 'hidden',
              }}
            >
              <ProgressiveImage
                src={url}
                alt={`Generated ${i + 1}`}
                className="w-full block nodrag"
                style={{ height: 'auto' }}
              />
            </div>
          ))}
        </div>
      )}

      <TypedHandle type="source" position={Position.Right} id="image" portType="image" connected={isOutputConnected} />
    </NodeWrapper>
  );
}
