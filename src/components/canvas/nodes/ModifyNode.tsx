'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Sliders, Play, Download } from 'lucide-react';
import { downloadFromUrl } from '@/lib/utils/download';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import { useFlowStore } from '@/lib/stores/flowStore';
import type { ModifyNodeData, ImageGenNodeData, ImageInputNodeData, UpscaleNodeData, SelectNodeData } from '@/types';

const MODIFY_MODELS = [
  { id: 'nano-banana-2',   name: 'Nano Banana 2 Edit' },
  { id: 'nano-banana-pro', name: 'Nano Banana Pro Edit' },
];

const IMAGE_ROW_HEIGHT = 36;

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

function nearestAspectRatio(w: number, h: number): string {
  const ratio = w / h;
  const candidates: [string, number][] = [
    ['1:1', 1], ['16:9', 16/9], ['9:16', 9/16],
    ['4:3', 4/3], ['3:4', 3/4], ['21:9', 21/9],
    ['3:2', 3/2], ['2:3', 2/3],
  ];
  let best = '1:1', bestDiff = Infinity;
  for (const [label, val] of candidates) {
    const diff = Math.abs(ratio - val);
    if (diff < bestDiff) { bestDiff = diff; best = label; }
  }
  return best;
}

export function ModifyNode({ data, selected, id }: NodeProps & { data: ModifyNodeData }) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const promptSectionRef = useRef<HTMLDivElement>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const imageSlotRef = useRef<HTMLDivElement>(null);
  const [promptHandleTop, setPromptHandleTop] = useState(50);
  const [imageHandleTop, setImageHandleTop] = useState(130);

  const storeEdges = useFlowStore(state => state.edges);
  const storeNodes = useFlowStore(state => state.nodes);

  // Derive source images + metadata directly from connected node (like UpscaleNode)
  const incomingEdge = storeEdges.find(e => e.target === id && e.targetHandle === 'image');
  const sourceNode = incomingEdge ? storeNodes.find(n => n.id === incomingEdge.source) : undefined;

  let availableImages: string[] = [];
  let sourceAspectRatio = '1:1';
  let sourceResolution = '1K';

  if (sourceNode?.type === 'imageGenNode') {
    const nd = sourceNode.data as ImageGenNodeData;
    availableImages = nd.generatedImages ?? [];
    sourceAspectRatio = nd.aspectRatio ?? '1:1';
    sourceResolution = nd.resolution ?? '1K';
  } else if (sourceNode?.type === 'imageInputNode') {
    const nd = sourceNode.data as ImageInputNodeData;
    if (nd.imageUrl) availableImages = [nd.imageUrl];
    if (nd.naturalWidth && nd.naturalHeight) sourceAspectRatio = nearestAspectRatio(nd.naturalWidth, nd.naturalHeight);
  } else if (sourceNode?.type === 'upscaleNode') {
    const nd = sourceNode.data as UpscaleNodeData;
    if (nd.outputImageUrl) availableImages = [nd.outputImageUrl];
  } else if (sourceNode?.type === 'modifyNode') {
    const nd = sourceNode.data as ModifyNodeData;
    if (nd.outputImageUrl) availableImages = [nd.outputImageUrl];
  } else if (sourceNode?.type === 'selectNode') {
    const url = (sourceNode.data as SelectNodeData).selectedImageUrl;
    if (url) availableImages = [url];
  }

  const safeIndex = Math.min(selectedIndex, Math.max(availableImages.length - 1, 0));
  const selectedImage = availableImages[safeIndex];
  const hasImage = !!selectedImage;

  // Reset selected index when source disconnects
  useEffect(() => {
    if (availableImages.length === 0) setSelectedIndex(0);
  }, [availableImages.length]);

  useEffect(() => {
    if (promptTextareaRef.current) autoResize(promptTextareaRef.current);
  }, [data.prompt]);

  useLayoutEffect(() => {
    if (promptSectionRef.current) {
      const el = promptSectionRef.current;
      setPromptHandleTop(el.offsetTop + el.offsetHeight / 2);
    }
    if (imageSlotRef.current) {
      setImageHandleTop(imageSlotRef.current.offsetTop + IMAGE_ROW_HEIGHT / 2);
    }
  });

  function updateData(updates: Partial<ModifyNodeData>) {
    document.dispatchEvent(new CustomEvent('node:update', {
      detail: { nodeId: id, data: updates },
    }));
  }

  async function handleGenerate() {
    if (isGenerating || !selectedImage) return;
    setIsGenerating(true);
    updateData({ status: 'processing' });

    // Re-derive at call time so values are current
    const edge = storeEdges.find(e => e.target === id && e.targetHandle === 'image');
    const src = edge ? storeNodes.find(n => n.id === edge.source) : undefined;
    let ar = '1:1', res = '1K';
    if (src?.type === 'imageGenNode') {
      ar = (src.data as ImageGenNodeData).aspectRatio ?? '1:1';
      res = (src.data as ImageGenNodeData).resolution ?? '1K';
    } else if (src?.type === 'imageInputNode') {
      const nd = src.data as ImageInputNodeData;
      if (nd.naturalWidth && nd.naturalHeight) ar = nearestAspectRatio(nd.naturalWidth, nd.naturalHeight);
    }

    try {
      const res2 = await fetch('/api/fal/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: data.model,
          prompt: data.prompt ?? '',
          aspectRatio: ar,
          resolution: res,
          numImages: 1,
          referenceImageUrls: [selectedImage],
          sourceType: 'canvas',
          nodeId: id,
        }),
      });
      const result = await res2.json();
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

      {/* Image input slot (handle anchor) */}
      <div
        ref={imageSlotRef}
        className="flex items-center text-xs"
        style={{
          height: IMAGE_ROW_HEIGHT,
          marginLeft: -12,
          paddingLeft: 14,
          paddingRight: 8,
          borderRadius: '0 6px 6px 0',
          background: hasImage ? '#3a1a6a' : 'var(--color-bg-surface)',
          border: hasImage ? 'none' : '1px solid rgba(255,255,255,0.08)',
          borderLeft: 'none',
          color: hasImage ? '#a855f7' : 'var(--color-white-muted)',
          transition: 'background 0.15s, color 0.15s',
          marginBottom: availableImages.length > 1 ? 8 : 12,
        }}
      >
        Source Image
      </div>

      {/* Multi-image selector (only shown when source has multiple variants) */}
      {availableImages.length > 1 && (
        <div className="flex gap-1.5 mb-3 overflow-x-auto nodrag">
          {availableImages.map((url, i) => (
            <button
              key={i}
              onClick={() => setSelectedIndex(i)}
              className="shrink-0 nodrag"
              style={{
                width: 40,
                height: 40,
                borderRadius: 6,
                padding: 0,
                overflow: 'hidden',
                outline: safeIndex === i ? '2px solid var(--color-accent)' : '2px solid transparent',
                outlineOffset: 1,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </button>
          ))}
        </div>
      )}

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
        disabled={isGenerating || !hasImage}
        className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-opacity disabled:opacity-40 nodrag"
        style={{ background: '#fff', color: '#000', borderRadius: 11 }}
      >
        <Play size={12} />
        {isGenerating ? 'Modifying…' : 'Modify'}
      </button>

      {data.outputImageUrl && (
        <button
          onClick={() => downloadFromUrl(data.outputImageUrl!)}
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
