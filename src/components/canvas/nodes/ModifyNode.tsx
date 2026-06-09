'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Sliders, Play, Download } from 'lucide-react';
import { downloadFromUrl } from '@/lib/utils/download';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import { ModelSelect } from './ModelSelect';
import { useFlowStore } from '@/lib/stores/flowStore';
import { ASPECT_RATIOS, RESOLUTIONS } from '@/lib/utils/constants';
import type { ModifyNodeData, ImageGenNodeData, ImageInputNodeData, UpscaleNodeData } from '@/types';

// ── Constants ──────────────────────────────────────────────────────────────────

const MODIFY_MODELS = [
  { id: 'nano-banana-2',   name: 'Nano Banana 2 Edit' },
  { id: 'nano-banana-pro', name: 'Nano Banana Pro Edit' },
];

const IMAGE_ROW_HEIGHT = 36;
const CANVAS_MAX_W = 232;
const CANVAS_MAX_H = 268;
const HANDLE_ZONE  = 10;

const ASPECT_PRESETS = [
  { label: '1:1',  ratio: 1 },
  { label: '4:3',  ratio: 4 / 3 },
  { label: '16:9', ratio: 16 / 9 },
  { label: '21:9', ratio: 21 / 9 },
  { label: '9:16', ratio: 9 / 16 },
  { label: '3:4',  ratio: 3 / 4 },
];

type AnchorKey = 'tl' | 't' | 'tr' | 'l' | 'c' | 'r' | 'bl' | 'b' | 'br';
const ANCHOR_GRID: AnchorKey[][] = [
  ['tl', 't', 'tr'],
  ['l',  'c', 'r' ],
  ['bl', 'b', 'br'],
];

// ── Helper functions ───────────────────────────────────────────────────────────

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

function anchorHV(a: AnchorKey): { h: 'left' | 'center' | 'right'; v: 'top' | 'center' | 'bottom' } {
  const map: Record<AnchorKey, { h: 'left' | 'center' | 'right'; v: 'top' | 'center' | 'bottom' }> = {
    tl: { h: 'left',   v: 'top'    }, t:  { h: 'center', v: 'top'    }, tr: { h: 'right',  v: 'top'    },
    l:  { h: 'left',   v: 'center' }, c:  { h: 'center', v: 'center' }, r:  { h: 'right',  v: 'center' },
    bl: { h: 'left',   v: 'bottom' }, b:  { h: 'center', v: 'bottom' }, br: { h: 'right',  v: 'bottom' },
  };
  return map[a];
}

function computeExpansionForAspect(
  imgW: number, imgH: number,
  targetRatio: number,
  anchor: AnchorKey,
): { top: number; right: number; bottom: number; left: number } {
  const { h, v } = anchorHV(anchor);
  const current = imgW / imgH;
  let top = 0, right = 0, bottom = 0, left = 0;

  if (Math.abs(targetRatio - current) < 0.005) return { top, right, bottom, left };

  if (targetRatio > current) {
    const total = Math.round(imgH * targetRatio) - imgW;
    if      (h === 'left')   right = total;
    else if (h === 'right')  left  = total;
    else { left = Math.floor(total / 2); right = total - left; }
  } else {
    const total = Math.round(imgW / targetRatio) - imgH;
    if      (v === 'top')    bottom = total;
    else if (v === 'bottom') top    = total;
    else { top = Math.floor(total / 2); bottom = total - top; }
  }

  return { top, right, bottom, left };
}

// ── ExpandCanvas ───────────────────────────────────────────────────────────────

interface ExpandCanvasProps {
  imageUrl: string;
  expandTop: number;
  expandRight: number;
  expandBottom: number;
  expandLeft: number;
  onChange: (updates: Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>) => void;
  onNaturalSize: (w: number, h: number) => void;
}

function ExpandCanvas({ imageUrl, expandTop, expandRight, expandBottom, expandLeft, onChange, onNaturalSize }: ExpandCanvasProps) {
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);

  const totalW = (naturalSize?.w ?? 1) + expandLeft + expandRight;
  const totalH = (naturalSize?.h ?? 1) + expandTop  + expandBottom;
  const scale  = Math.min(CANVAS_MAX_W / totalW, CANVAS_MAX_H / totalH);

  const dispW   = Math.round(totalW * scale);
  const dispH   = Math.round(totalH * scale);
  const imgW    = Math.round((naturalSize?.w ?? 0) * scale);
  const imgH    = Math.round((naturalSize?.h ?? 0) * scale);
  const imgX    = Math.round(expandLeft * scale);
  const imgY    = Math.round(expandTop  * scale);

  const zoneT = imgY;
  const zoneB = dispH - imgY - imgH;
  const zoneL = imgX;
  const zoneR = dispW - imgX - imgW;

  function startDrag(side: 'top' | 'right' | 'bottom' | 'left', e: React.MouseEvent) {
    const MAX_DIM = 2560;
    const natW = naturalSize?.w ?? 0;
    const natH = naturalSize?.h ?? 0;
    const startExpand = side === 'top' ? expandTop : side === 'right' ? expandRight : side === 'bottom' ? expandBottom : expandLeft;
    const startMouse  = (side === 'left' || side === 'right') ? e.clientX : e.clientY;
    const frozenScale = scale;
    const maxExpand =
      side === 'right'  ? Math.max(0, MAX_DIM - natW - expandLeft) :
      side === 'left'   ? Math.max(0, MAX_DIM - natW - expandRight) :
      side === 'bottom' ? Math.max(0, MAX_DIM - natH - expandTop) :
                          Math.max(0, MAX_DIM - natH - expandBottom);

    function onMove(me: MouseEvent) {
      let newVal: number;
      if      (side === 'right')  newVal = Math.max(0, Math.round(startExpand + (me.clientX - startMouse) / frozenScale));
      else if (side === 'left')   newVal = Math.max(0, Math.round(startExpand - (me.clientX - startMouse) / frozenScale));
      else if (side === 'bottom') newVal = Math.max(0, Math.round(startExpand + (me.clientY - startMouse) / frozenScale));
      else                        newVal = Math.max(0, Math.round(startExpand - (me.clientY - startMouse) / frozenScale));
      onChange({ [side]: Math.min(newVal, maxExpand) });
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    e.preventDefault();
    e.stopPropagation();
  }

  if (!naturalSize) {
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="" style={{ display: 'none' }} onLoad={(e) => {
          const img = e.currentTarget;
          const s = { w: img.naturalWidth, h: img.naturalHeight };
          setNaturalSize(s);
          onNaturalSize(s.w, s.h);
        }} />
        <div className="flex items-center justify-center rounded-lg mb-3" style={{ height: 80, background: 'var(--color-bg-surface)', color: 'var(--color-white-muted)', fontSize: 11 }}>
          Loading…
        </div>
      </>
    );
  }

  const STRIPE = 'repeating-linear-gradient(-45deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 3px, transparent 3px, transparent 7px)';
  const hasAny = expandTop > 0 || expandRight > 0 || expandBottom > 0 || expandLeft > 0;

  return (
    <div
      className="nodrag mx-auto mb-3"
      style={{ position: 'relative', width: dispW, height: dispH, flexShrink: 0, userSelect: 'none' }}
    >
      {/* Expansion background */}
      {hasAny && (
        <div style={{ position: 'absolute', inset: 0, background: STRIPE, borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)' }} />
      )}

      {/* Source image */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt="Source"
        style={{
          position: 'absolute',
          left: imgX, top: imgY,
          width: imgW, height: imgH,
          display: 'block',
          pointerEvents: 'none',
          borderRadius: hasAny ? 0 : 5,
        }}
      />

      {/* Dashed border on expansion sides */}
      <div style={{
        position: 'absolute',
        left: imgX, top: imgY, width: imgW, height: imgH,
        pointerEvents: 'none',
        borderTop:    expandTop    > 0 ? '1px dashed rgba(255,255,255,0.3)' : 'none',
        borderRight:  expandRight  > 0 ? '1px dashed rgba(255,255,255,0.3)' : 'none',
        borderBottom: expandBottom > 0 ? '1px dashed rgba(255,255,255,0.3)' : 'none',
        borderLeft:   expandLeft   > 0 ? '1px dashed rgba(255,255,255,0.3)' : 'none',
      }} />

      {/* Expansion labels */}
      {expandTop > 0 && zoneT >= 14 && (
        <div style={{ position: 'absolute', top: zoneT / 2 - 5, left: 0, right: 0, textAlign: 'center', fontSize: 9, color: 'rgba(255,255,255,0.45)', pointerEvents: 'none' }}>
          +{expandTop}px
        </div>
      )}
      {expandBottom > 0 && zoneB >= 14 && (
        <div style={{ position: 'absolute', top: imgY + imgH + zoneB / 2 - 5, left: 0, right: 0, textAlign: 'center', fontSize: 9, color: 'rgba(255,255,255,0.45)', pointerEvents: 'none' }}>
          +{expandBottom}px
        </div>
      )}
      {expandLeft > 0 && zoneL >= 22 && (
        <div style={{ position: 'absolute', top: '50%', left: 0, width: zoneL, textAlign: 'center', fontSize: 9, color: 'rgba(255,255,255,0.45)', pointerEvents: 'none', transform: 'translateY(-50%)' }}>
          +{expandLeft}
        </div>
      )}
      {expandRight > 0 && zoneR >= 22 && (
        <div style={{ position: 'absolute', top: '50%', right: 0, width: zoneR, textAlign: 'center', fontSize: 9, color: 'rgba(255,255,255,0.45)', pointerEvents: 'none', transform: 'translateY(-50%)' }}>
          +{expandRight}
        </div>
      )}

      {/* Drag handle: Top */}
      <div
        className="nodrag"
        style={{ position: 'absolute', top: 0, left: HANDLE_ZONE, right: HANDLE_ZONE, height: HANDLE_ZONE, cursor: 'ns-resize', zIndex: 3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onMouseDown={(e) => startDrag('top', e)}
      >
        <div style={{ width: 20, height: 2, background: 'rgba(255,255,255,0.45)', borderRadius: 1 }} />
      </div>

      {/* Drag handle: Bottom */}
      <div
        className="nodrag"
        style={{ position: 'absolute', bottom: 0, left: HANDLE_ZONE, right: HANDLE_ZONE, height: HANDLE_ZONE, cursor: 'ns-resize', zIndex: 3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onMouseDown={(e) => startDrag('bottom', e)}
      >
        <div style={{ width: 20, height: 2, background: 'rgba(255,255,255,0.45)', borderRadius: 1 }} />
      </div>

      {/* Drag handle: Left */}
      <div
        className="nodrag"
        style={{ position: 'absolute', left: 0, top: HANDLE_ZONE, bottom: HANDLE_ZONE, width: HANDLE_ZONE, cursor: 'ew-resize', zIndex: 3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onMouseDown={(e) => startDrag('left', e)}
      >
        <div style={{ height: 20, width: 2, background: 'rgba(255,255,255,0.45)', borderRadius: 1 }} />
      </div>

      {/* Drag handle: Right */}
      <div
        className="nodrag"
        style={{ position: 'absolute', right: 0, top: HANDLE_ZONE, bottom: HANDLE_ZONE, width: HANDLE_ZONE, cursor: 'ew-resize', zIndex: 3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onMouseDown={(e) => startDrag('right', e)}
      >
        <div style={{ height: 20, width: 2, background: 'rgba(255,255,255,0.45)', borderRadius: 1 }} />
      </div>
    </div>
  );
}

// ── AnchorPicker ───────────────────────────────────────────────────────────────

function AnchorPicker({ value, onChange }: { value: AnchorKey; onChange: (v: AnchorKey) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 16px)', gap: 3 }}>
      {ANCHOR_GRID.flat().map((anchor) => (
        <button
          key={anchor}
          className="nodrag"
          style={{
            width: 16, height: 16, borderRadius: 3, padding: 0, cursor: 'pointer', position: 'relative',
            border:      value === anchor ? '1.5px solid rgba(255,255,255,0.75)' : '1px solid rgba(255,255,255,0.15)',
            background:  value === anchor ? 'rgba(255,255,255,0.12)' : 'transparent',
          }}
          onClick={() => onChange(anchor)}
        >
          <div style={{
            position: 'absolute', width: 4, height: 4, borderRadius: '50%',
            background: value === anchor ? '#fff' : 'rgba(255,255,255,0.3)',
            top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          }} />
        </button>
      ))}
    </div>
  );
}

// ── ModifyNode ─────────────────────────────────────────────────────────────────

export function ModifyNode({ data, selected, id }: NodeProps & { data: ModifyNodeData }) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const promptSectionRef = useRef<HTMLDivElement>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const imageSlotRef = useRef<HTMLDivElement>(null);
  const [promptHandleTop, setPromptHandleTop] = useState(50);
  const [imageHandleTop, setImageHandleTop]   = useState(130);
  // Natural size lifted from ExpandCanvas so aspect presets can use it
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);

  const mode         = (data.mode as 'prompt' | 'expand') ?? 'prompt';
  const expandTop    = (data.expandTop    as number) ?? 0;
  const expandRight  = (data.expandRight  as number) ?? 0;
  const expandBottom = (data.expandBottom as number) ?? 0;
  const expandLeft   = (data.expandLeft   as number) ?? 0;
  const expandAnchor = (data.expandAnchor as AnchorKey) ?? 'c';

  const storeEdges = useFlowStore(state => state.edges);
  const storeNodes = useFlowStore(state => state.nodes);

  const incomingEdge = storeEdges.find(e => e.target === id && e.targetHandle === 'image');
  const sourceNode   = incomingEdge ? storeNodes.find(n => n.id === incomingEdge.source) : undefined;

  let availableImages: string[] = [];
  let sourceAspectRatio = '1:1';
  let sourceResolution  = '1K';

  if (sourceNode?.type === 'imageGenNode') {
    const nd = sourceNode.data as ImageGenNodeData;
    availableImages   = nd.generatedImages ?? [];
    sourceAspectRatio = nd.aspectRatio ?? '1:1';
    sourceResolution  = nd.resolution  ?? '1K';
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
    const url = (sourceNode.data as { selectedImageUrl?: string }).selectedImageUrl;
    if (url) availableImages = [url];
  }

  const safeIndex    = Math.min(selectedIndex, Math.max(availableImages.length - 1, 0));
  const selectedImage = availableImages[safeIndex];
  const hasImage      = !!selectedImage;

  const derivedAspect = (() => {
    if (sourceNode?.type === 'imageGenNode') return (sourceNode.data as ImageGenNodeData).aspectRatio ?? undefined;
    if (sourceNode?.type === 'imageInputNode') {
      const nd = sourceNode.data as ImageInputNodeData;
      if (nd.naturalWidth && nd.naturalHeight) return nearestAspectRatio(nd.naturalWidth, nd.naturalHeight);
    }
    return undefined;
  })();

  const derivedResolution = (() => {
    if (sourceNode?.type === 'imageGenNode') return (sourceNode.data as ImageGenNodeData).resolution ?? undefined;
    if (sourceNode?.type === 'imageInputNode') {
      const nd = sourceNode.data as ImageInputNodeData;
      if (nd.naturalWidth) return nd.naturalWidth >= 3000 ? '4K' : nd.naturalWidth >= 1800 ? '2K' : '1K';
    }
    return undefined;
  })();

  useEffect(() => {
    if (derivedAspect && derivedAspect !== data.aspectRatio) updateData({ aspectRatio: derivedAspect });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivedAspect]);

  useEffect(() => {
    if (derivedResolution && derivedResolution !== data.resolution) updateData({ resolution: derivedResolution });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivedResolution]);

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

  function handleExpandChange(updates: Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>) {
    const mapped: Partial<ModifyNodeData> = {};
    if (updates.top    !== undefined) mapped.expandTop    = updates.top;
    if (updates.right  !== undefined) mapped.expandRight  = updates.right;
    if (updates.bottom !== undefined) mapped.expandBottom = updates.bottom;
    if (updates.left   !== undefined) mapped.expandLeft   = updates.left;
    updateData(mapped);
  }

  function handleAspectPreset(ratio: number) {
    if (!naturalSize) return;
    const exp = computeExpansionForAspect(naturalSize.w, naturalSize.h, ratio, expandAnchor);
    const MAX_DIM = 2560;
    const maxW = Math.max(0, MAX_DIM - naturalSize.w);
    const maxH = Math.max(0, MAX_DIM - naturalSize.h);
    const totalW = exp.left + exp.right;
    const totalH = exp.top  + exp.bottom;
    if (totalW > maxW) {
      const s = maxW / totalW;
      exp.left  = Math.floor(exp.left  * s);
      exp.right = maxW - exp.left;
    }
    if (totalH > maxH) {
      const s = maxH / totalH;
      exp.top    = Math.floor(exp.top    * s);
      exp.bottom = maxH - exp.top;
    }
    updateData({ expandTop: exp.top, expandRight: exp.right, expandBottom: exp.bottom, expandLeft: exp.left });
  }

  async function handlePromptGenerate() {
    if (isGenerating || !selectedImage) return;
    setIsGenerating(true);
    updateData({ status: 'processing' });

    const aspectRatio = data.aspectRatio ?? '1:1';
    const resolution  = data.resolution  ?? '1K';

    try {
      const res    = await fetch('/api/fal/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: data.model, prompt: data.prompt ?? '',
          aspectRatio, resolution, numImages: 1,
          referenceImageUrls: [selectedImage],
          sourceType: 'canvas', nodeId: id,
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

  async function handleExpandGenerate() {
    if (isGenerating || !selectedImage) return;
    if (!expandTop && !expandRight && !expandBottom && !expandLeft) return;
    setIsGenerating(true);
    updateData({ status: 'processing' });

    try {
      const res    = await fetch('/api/fal/outpaint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: selectedImage,
          expandTop, expandRight, expandBottom, expandLeft,
          sourceType: 'canvas', nodeId: id,
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

  const hasExpansion = expandTop > 0 || expandRight > 0 || expandBottom > 0 || expandLeft > 0;
  const outputDimsLabel = naturalSize && hasExpansion
    ? `${naturalSize.w + expandLeft + expandRight} × ${naturalSize.h + expandTop + expandBottom}px`
    : null;

  return (
    <NodeWrapper
      title="Modify"
      icon={<Sliders size={14} />}
      status={data.status}
      selected={selected}
      minWidth={280}
      accentColor={PORT_COLORS.image}
    >
      {/* Handles */}
      {mode === 'prompt' && (
        <TypedHandle type="target" position={Position.Left} id="prompt" portType="text"  offset={`${promptHandleTop}px`} />
      )}
      <TypedHandle type="target" position={Position.Left} id="image"  portType="image" offset={`${imageHandleTop}px`}  />

      {/* ── Mode toggle ── */}
      <div
        className="flex gap-0.5 mb-3 p-0.5 nodrag"
        style={{ background: 'var(--color-bg-surface)', borderRadius: 11 }}
      >
        {(['prompt', 'expand'] as const).map((m) => (
          <button
            key={m}
            className="nodrag flex-1 py-1 text-xs font-medium capitalize transition-colors"
            style={{
              borderRadius: 9,
              background: mode === m ? '#fff' : 'transparent',
              color:       mode === m ? '#000' : 'var(--color-white-muted)',
              border: 'none', cursor: 'pointer',
            }}
            onClick={() => updateData({ mode: m })}
          >
            {m === 'prompt' ? 'Prompt' : 'Expand'}
          </button>
        ))}
      </div>

      {/* ── Prompt mode ── */}
      {mode === 'prompt' && (
        <>
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
                style={{ background: 'transparent', border: 'none', color: 'var(--color-white)', resize: 'none', overflow: 'hidden', minHeight: 40 }}
              />
            )}
          </div>

          {/* Image slot */}
          <div
            ref={imageSlotRef}
            className="flex items-center text-xs"
            style={{
              height: IMAGE_ROW_HEIGHT,
              marginLeft: -12, paddingLeft: 14, paddingRight: 8,
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

          {/* Multi-image selector */}
          {availableImages.length > 1 && (
            <div className="flex gap-1.5 mb-3 overflow-x-auto nodrag">
              {availableImages.map((url, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedIndex(i)}
                  className="shrink-0 nodrag"
                  style={{ width: 40, height: 40, borderRadius: 6, padding: 0, overflow: 'hidden',
                    outline: safeIndex === i ? '2px solid var(--color-accent)' : '2px solid transparent', outlineOffset: 1 }}
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
            <ModelSelect options={MODIFY_MODELS} value={data.model} onChange={(v) => updateData({ model: v })} />
          </div>

          {/* Aspect + Resolution */}
          <div className="flex gap-2 mb-3">
            <div className="flex-1">
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Aspect</label>
              <select
                className="w-full px-2 py-1.5 rounded-lg text-xs outline-none nodrag"
                value={data.aspectRatio ?? '1:1'}
                onChange={(e) => updateData({ aspectRatio: e.target.value })}
                style={{ background: 'var(--color-bg-surface)', border: 'none', color: 'var(--color-white)', borderRadius: 11 }}
              >
                {ASPECT_RATIOS.map((r) => (
                  <option key={r.value} value={r.value}>{r.value}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Resolution</label>
              <select
                className="w-full px-2 py-1.5 rounded-lg text-xs outline-none nodrag"
                value={data.resolution ?? '1K'}
                onChange={(e) => updateData({ resolution: e.target.value })}
                style={{ background: 'var(--color-bg-surface)', border: 'none', color: 'var(--color-white)', borderRadius: 11 }}
              >
                {RESOLUTIONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Output preview */}
          {data.outputImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.outputImageUrl} alt="Modified" className="w-full block rounded-lg mb-3 nodrag" style={{ height: 'auto' }} />
          )}

          <button
            onClick={handlePromptGenerate}
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
        </>
      )}

      {/* ── Expand mode ── */}
      {mode === 'expand' && (
        <>
          {/* Image slot (keeps TypedHandle aligned) */}
          <div
            ref={imageSlotRef}
            className="flex items-center text-xs mb-3"
            style={{
              height: IMAGE_ROW_HEIGHT,
              marginLeft: -12, paddingLeft: 14, paddingRight: 8,
              borderRadius: '0 6px 6px 0',
              background: hasImage ? '#3a1a6a' : 'var(--color-bg-surface)',
              border: hasImage ? 'none' : '1px solid rgba(255,255,255,0.08)',
              borderLeft: 'none',
              color: hasImage ? '#a855f7' : 'var(--color-white-muted)',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            Source Image
          </div>

          {/* Multi-image selector */}
          {availableImages.length > 1 && (
            <div className="flex gap-1.5 mb-3 overflow-x-auto nodrag">
              {availableImages.map((url, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedIndex(i)}
                  className="shrink-0 nodrag"
                  style={{ width: 40, height: 40, borderRadius: 6, padding: 0, overflow: 'hidden',
                    outline: safeIndex === i ? '2px solid var(--color-accent)' : '2px solid transparent', outlineOffset: 1 }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </button>
              ))}
            </div>
          )}

          {/* Aspect presets + Anchor (side by side) */}
          <div className="flex items-start gap-3 mb-3">
            <div className="flex-1">
              <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--color-white-muted)' }}>Preset</label>
              <div className="flex flex-wrap gap-1">
                {ASPECT_PRESETS.map(({ label, ratio }) => (
                  <button
                    key={label}
                    className="nodrag text-xs px-2 py-0.5 rounded-md transition-colors"
                    style={{
                      background: 'var(--color-bg-surface)',
                      color: 'var(--color-white-muted)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      cursor: naturalSize ? 'pointer' : 'default',
                      opacity: naturalSize ? 1 : 0.4,
                    }}
                    onClick={() => handleAspectPreset(ratio)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--color-white-muted)' }}>Anchor</label>
              <AnchorPicker value={expandAnchor} onChange={(v) => updateData({ expandAnchor: v })} />
            </div>
          </div>

          {/* Expand canvas */}
          {selectedImage ? (
            <ExpandCanvas
              imageUrl={selectedImage}
              expandTop={expandTop}
              expandRight={expandRight}
              expandBottom={expandBottom}
              expandLeft={expandLeft}
              onChange={handleExpandChange}
              onNaturalSize={(w, h) => setNaturalSize({ w, h })}
            />
          ) : (
            <div
              className="flex items-center justify-center rounded-lg mb-3 text-xs"
              style={{ height: 80, background: 'var(--color-bg-surface)', border: '1px dashed rgba(255,255,255,0.12)', color: 'var(--color-white-muted)' }}
            >
              Connect a source image
            </div>
          )}

          {/* Output dimensions label */}
          {outputDimsLabel && (
            <p className="text-center mb-2" style={{ fontSize: 10, color: 'var(--color-white-muted)' }}>
              Output: {outputDimsLabel}
            </p>
          )}

          {/* Output preview */}
          {data.outputImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.outputImageUrl} alt="Expanded" className="w-full block rounded-lg mb-3 nodrag" style={{ height: 'auto' }} />
          )}

          <button
            onClick={handleExpandGenerate}
            disabled={isGenerating || !hasImage || !hasExpansion}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-opacity disabled:opacity-40 nodrag"
            style={{ background: '#fff', color: '#000', borderRadius: 11 }}
          >
            <Play size={12} />
            {isGenerating ? 'Expanding…' : 'Expand'}
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
        </>
      )}

      <TypedHandle type="source" position={Position.Right} id="image" portType="image" />
    </NodeWrapper>
  );
}
