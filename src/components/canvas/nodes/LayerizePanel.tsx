'use client';

import { GenerationPreview } from './GenerationPreview';

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type PointerEvent, type RefObject } from 'react';
import { ArrowDownToLine, ChevronDown, ChevronUp, Download, Eye, EyeOff, ImagePlus, Layers, Loader2, Minus, Plus, RotateCcw } from 'lucide-react';
import type { ModifyNodeData } from '@/types';
import { arrangeOriginal, layerCanvasSize, sameLayerizeSource, type EditableLayer } from '@/lib/layerize';
import { useFlowStore } from '@/lib/stores/flowStore';
import { uploadImageToStorage } from '@/lib/utils/uploadImage';
import { downloadAllFromUrls, downloadFromUrl } from '@/lib/utils/download';
import { playSuccessSound } from '@/lib/utils/sound';
import { cn } from '@/lib/utils/cn';
import glass from './ImageGenerationGlass.module.css';
import styles from './LayerizePanel.module.css';

function IconButton({ title, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={styles.iconButton} title={title} aria-label={title} {...props}>{children}</button>;
}

const EMPTY_LAYERS: EditableLayer[] = [];

async function compositionBlob(layers: EditableLayer[]): Promise<Blob> {
  const { width, height } = layerCanvasSize(layers);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create the composition.');
  const visible = layers.filter(layer => layer.visible);
  const images = await Promise.all(visible.map(async layer => {
    const image = new window.Image();
    image.crossOrigin = 'anonymous';
    image.src = layer.imageUrl;
    await image.decode();
    return image;
  }));
  visible.forEach((layer, i) => {
    const { x, y, width, height } = layer.bounds;
    context.drawImage(images[i], x, y, width, height);
  });
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not export the composition.')), 'image/png'));
}

async function validateSource(blob: Blob) {
  if (blob.size > 30 * 1024 * 1024) throw new Error('Source images must be 30 MB or smaller.');
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  bitmap.close();
  if (width * height < 512 * 512 || width * height > 6000 * 6000 || width / height < 1 / 16 || width / height > 16) {
    throw new Error('Source must contain 262,144 to 36,000,000 pixels with an aspect ratio between 1:16 and 16:1.');
  }
}

interface Props {
  id: string;
  data: ModifyNodeData;
  connectedImage?: string;
  sourceSlotRef: RefObject<HTMLDivElement | null>;
  updateData: (updates: Partial<ModifyNodeData>) => void;
}

export function LayerizePanel({ id, data, connectedImage, sourceSlotRef, updateData }: Props) {
  const source = connectedImage ?? data.layerizeInputUrl;
  const layers = data.layerizeLayers ?? EMPTY_LAYERS;
  const selected = layers.find(layer => layer.id === data.layerizeSelectedId) ?? layers.at(-1);
  const { width, height } = layerCanvasSize(layers);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string>();
  const operation = useRef<AbortController | null>(null);
  const sourceInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; x: number; y: number; startX: number; startY: number; ratioX: number; ratioY: number } | null>(null);
  const changedSource = layers.length > 0 && !sameLayerizeSource(source, data.layerizeSourceUrl);

  useEffect(() => () => operation.current?.abort(), []);

  // Keep the node's image output in sync after an edit settles, including edits
  // restored from a saved flow. Discard stale exports when another edit starts.
  useEffect(() => {
    if (!data.layerizeCompositionDirty || !layers.length || busy || uploading || dragging) return;
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const blob = await compositionBlob(layers);
        if (stale) return;
        const imageUrl = await uploadImageToStorage(new File([blob], 'layerize-composition.png', { type: 'image/png' }));
        if (stale) return;
        document.dispatchEvent(new CustomEvent('node:update', { detail: { nodeId: id, data: { outputImageUrl: imageUrl, layerizeCompositionDirty: false } } }));
        document.dispatchEvent(new CustomEvent('node:image-propagate', { detail: { sourceNodeId: id, imageUrl } }));
        setError(undefined);
      } catch (error) {
        if (!stale) setError(error instanceof Error ? error.message : 'Could not save the composition output.');
      }
    }, 800);
    return () => { stale = true; clearTimeout(timer); };
  }, [layers, data.layerizeCompositionDirty, busy, uploading, dragging, id]);

  function publishOutput(imageUrl: string) {
    updateData({ outputImageUrl: imageUrl });
    document.dispatchEvent(new CustomEvent('node:image-propagate', { detail: { sourceNodeId: id, imageUrl } }));
  }

  function updateLayer(layerId: string, updates: Partial<EditableLayer>) {
    updateData({ layerizeLayers: layers.map(layer => layer.id === layerId ? { ...layer, ...updates } : layer), layerizeCompositionDirty: true });
  }

  async function upload(file: File, replacingId?: string) {
    setUploading(true);
    setError(undefined);
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG, or WebP image.');
      if (file.size > 30 * 1024 * 1024) throw new Error('Images must be 30 MB or smaller.');
      if (!replacingId) await validateSource(file);
      const imageUrl = await uploadImageToStorage(file);
      if (replacingId) updateLayer(replacingId, { imageUrl });
      else updateData({ layerizeInputUrl: imageUrl });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Image upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function generate(resume = false) {
    if (operation.current || (!source && !resume)) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError(undefined);
    updateData({ status: 'processing', errorMessage: undefined });
    try {
      let requestId = resume ? data.layerizeRequestId : undefined;
      if (!requestId) {
        const input = await fetch(source!, { signal: controller.signal });
        if (!input.ok) throw new Error('Could not load the source image.');
        await validateSource(await input.blob());
        useFlowStore.getState().consumeGcsOnlyEligibility();
        const response = await fetch('/api/fal/layerize', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({ imageUrl: source, sourceId: useFlowStore.getState().currentFlow?.id, nodeId: id }),
        });
        const result = await response.json();
        if (!response.ok || !result.requestId) throw new Error(result.error ?? 'Could not start Layerize.');
        requestId = result.requestId;
        updateData({ layerizeRequestId: requestId, layerizeRequestSourceUrl: source });
      }
      let consecutiveErrors = 0;
      for (let attempt = 0; attempt < 200; attempt++) {
        controller.signal.throwIfAborted();
        let response: Response | undefined;
        try {
          response = await fetch(`/api/fal/layerize/status/${encodeURIComponent(requestId!)}`, { signal: controller.signal });
        } catch (error) {
          if (controller.signal.aborted) throw error;
        }
        if (response?.ok) {
          consecutiveErrors = 0;
          const result = await response.json();
          if (result.status === 'failed') {
            updateData({ layerizeRequestId: undefined });
            throw new Error(result.error ?? 'Layerize failed.');
          }
          if (result.status === 'completed') {
            if (!result.layers?.length || !result.imageUrl) throw new Error('Layerize returned no layers.');
            updateData({ layerizeLayers: result.layers, layerizeSelectedId: result.layers.at(-1).id, layerizeRequestId: undefined, layerizeSourceUrl: resume ? data.layerizeRequestSourceUrl : source, layerizeRequestSourceUrl: undefined, layerizeCompositionDirty: false, status: 'completed', errorMessage: undefined });
            publishOutput(result.imageUrl);
            playSuccessSound();
            return;
          }
        } else if (response && [401, 403, 404].includes(response.status)) {
          if (response.status === 404) updateData({ layerizeRequestId: undefined });
          throw new Error((await response.json()).error ?? 'Could not retrieve Layerize request.');
        } else {
          consecutiveErrors++;
          if (consecutiveErrors >= 5) {
            throw new Error('Could not retrieve the layers. Check status to retry the existing request.');
          }
        }
        await new Promise<void>(resolve => {
          const finish = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', finish); resolve(); };
          const timer = setTimeout(finish, 3000);
          controller.signal.addEventListener('abort', finish, { once: true });
        });
      }
      throw new Error('Layerize is taking longer than expected. Check status to retrieve the existing request.');
    } catch (error) {
      if (!controller.signal.aborted) updateData({ status: 'error', errorMessage: error instanceof Error ? error.message : 'Layerize failed.' });
    } finally {
      operation.current = null;
      setBusy(false);
    }
  }

  function moveOrder(layerId: string, direction: -1 | 1) {
    const index = layers.findIndex(layer => layer.id === layerId);
    const next = [...layers];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    updateData({ layerizeLayers: next, layerizeCompositionDirty: true });
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>, layer: EditableLayer) {
    if (event.button !== 0) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    updateData({ layerizeSelectedId: layer.id });
    drag.current = { id: layer.id, x: event.clientX, y: event.clientY, startX: layer.bounds.x, startY: layer.bounds.y, ratioX: width / rect.width, ratioY: height / rect.height };
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>, layer: EditableLayer) {
    const current = drag.current;
    if (!current || current.id !== layer.id) return;
    updateLayer(layer.id, { bounds: { ...layer.bounds,
      x: current.startX + (event.clientX - current.x) * current.ratioX,
      y: current.startY + (event.clientY - current.y) * current.ratioY,
    } });
  }

  function scaleLayer(delta: number) {
    if (!selected) return;
    const scale = Math.min(4, Math.max(0.1, selected.bounds.width / selected.original.width + delta));
    const w = selected.original.width * scale;
    const h = selected.original.height * scale;
    updateLayer(selected.id, { bounds: { x: selected.bounds.x + (selected.bounds.width - w) / 2, y: selected.bounds.y + (selected.bounds.height - h) / 2, width: w, height: h } });
  }

  async function download(all: boolean) {
    setDownloading(true);
    setError(undefined);
    try {
      if (all) await downloadAllFromUrls(layers.map(layer => layer.imageUrl), 'seedream-layers');
      else {
        const blob = await compositionBlob(layers);
        const url = URL.createObjectURL(blob);
        try { await downloadFromUrl(url, 'layerize-composition.png'); }
        finally { URL.revokeObjectURL(url); }
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Download failed.');
    } finally { setDownloading(false); }
  }

  return <div className={cn(styles.panel, 'nodrag nowheel nopan')}>
    <div ref={sourceSlotRef} className={styles.sourceHeading}>
      <span>Source Image</span>
      {!connectedImage && <IconButton title={source ? 'Replace source image' : 'Upload source image'} disabled={busy || uploading} onClick={() => sourceInput.current?.click()}><ImagePlus size={14} /></IconButton>}
    </div>
    <input ref={sourceInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }} />
    {source ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={source} alt="Layerize source" className={styles.sourceImage} draggable={false} />
    ) : <button className={styles.upload} disabled={uploading} onClick={() => sourceInput.current?.click()}><ImagePlus size={22} />{uploading ? 'Uploading...' : 'Upload image'}</button>}
    <GenerationPreview
      transient
      pending={busy || data.status === 'processing'}
      failed={data.status === 'error'}
      resultSrc={data.outputImageUrl}
      sizingSource={source}
    >
      {data.outputImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data.outputImageUrl} alt="Generated composition" style={{ display: 'block', width: '100%', height: 'auto' }} />
      )}
    </GenerationPreview>
    {changedSource && <p className={styles.notice}>Source changed. Layerize to update the layers.</p>}

    {layers.length > 0 && <>
      <div className={styles.heading}><span>Layers</span><span>{layers.filter(layer => layer.visible).length}/{layers.length}</span></div>
      <div className={styles.layerList}>
        {[...layers].reverse().map(layer => {
          const index = layers.indexOf(layer);
          return <div key={layer.id} className={cn(styles.layerRow, selected?.id === layer.id && styles.activeRow)}>
            <button className={styles.layerSelect} onClick={() => updateData({ layerizeSelectedId: layer.id })} aria-pressed={selected?.id === layer.id} title={layer.name}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={layer.imageUrl} alt="" draggable={false} />
              <span>{layer.name}</span>
            </button>
            <div className={styles.orderButtons}>
              <IconButton title={`Move ${layer.name} up`} disabled={index === layers.length - 1 || busy || uploading} onClick={() => moveOrder(layer.id, 1)}><ChevronUp size={12} /></IconButton>
              <IconButton title={`Move ${layer.name} down`} disabled={index === 0 || busy || uploading} onClick={() => moveOrder(layer.id, -1)}><ChevronDown size={12} /></IconButton>
            </div>
            <IconButton title={`Download ${layer.name}`} onClick={() => downloadFromUrl(layer.imageUrl, `layer-${layer.originalOrder}-${layer.name.replace(/[^a-z0-9-]/gi, '_')}`)}><ArrowDownToLine size={13} /></IconButton>
            <IconButton title={`${layer.visible ? 'Hide' : 'Show'} ${layer.name}`} aria-pressed={layer.visible} disabled={busy || uploading} onClick={() => updateLayer(layer.id, { visible: !layer.visible })}>{layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}</IconButton>
          </div>;
        })}
      </div>

      <div className={styles.heading}><span>Composition</span><IconButton title="Download composition" disabled={downloading} onClick={() => download(false)}><Download size={14} /></IconButton></div>
      <div className={styles.canvasArea}>
        <div ref={canvasRef} className={styles.canvas} style={{ aspectRatio: `${width} / ${height}`, width: Math.min(280, 220 * width / height) }} aria-label="Layer composition">
          {layers.map(layer => layer.visible && <button key={layer.id} className={cn(styles.canvasLayer, selected?.id === layer.id && styles.selectedLayer)}
            aria-label={`Position ${layer.name}`} disabled={busy || uploading}
            style={{ left: `${layer.bounds.x / width * 100}%`, top: `${layer.bounds.y / height * 100}%`, width: `${layer.bounds.width / width * 100}%`, height: `${layer.bounds.height / height * 100}%` }}
            onPointerDown={event => startDrag(event, layer)} onPointerMove={event => moveDrag(event, layer)}
            onPointerUp={event => { drag.current = null; setDragging(false); event.currentTarget.releasePointerCapture(event.pointerId); }}
            onPointerCancel={() => { drag.current = null; setDragging(false); }}
            onFocus={() => updateData({ layerizeSelectedId: layer.id })}
            onKeyDown={event => {
              const delta = event.shiftKey ? 10 : 1;
              const offset = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] }[event.key];
              if (offset) { event.preventDefault(); event.stopPropagation(); updateLayer(layer.id, { bounds: { ...layer.bounds, x: layer.bounds.x + offset[0], y: layer.bounds.y + offset[1] } }); }
            }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={layer.imageUrl} alt="" draggable={false} />
          </button>)}
        </div>
      </div>
      <button className={styles.action} disabled={busy || uploading} onClick={() => updateData({ layerizeLayers: arrangeOriginal(layers), layerizeCompositionDirty: true })}><RotateCcw size={13} />Arrange Original</button>

      {selected && <div className={styles.inspector}>
        <div className={styles.selectedInfo}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={selected.imageUrl} alt={selected.name} draggable={false} />
          <div><strong>{selected.name}</strong>{selected.description && <p>{selected.description}</p>}</div>
        </div>
        <div className={styles.inspectorActions}>
          <div className={styles.scale}>
            <IconButton title="Scale layer down" disabled={busy || uploading || selected.bounds.width / selected.original.width <= 0.101} onClick={() => scaleLayer(-0.1)}><Minus size={13} /></IconButton>
            <span>{Math.round(selected.bounds.width / selected.original.width * 100)}%</span>
            <IconButton title="Scale layer up" disabled={busy || uploading || selected.bounds.width / selected.original.width >= 4} onClick={() => scaleLayer(0.1)}><Plus size={13} /></IconButton>
          </div>
          <IconButton title="Replace layer image" disabled={busy || uploading} onClick={() => replaceInput.current?.click()}><ImagePlus size={15} /></IconButton>
          <button className={styles.action} onClick={() => downloadFromUrl(selected.imageUrl, `layer-${selected.originalOrder}`)}><Download size={13} />Layer</button>
        </div>
        <input ref={replaceInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file, selected.id); }} />
      </div>}
    </>}

    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={cn(glass.footerStack, styles.footer)}>
      <button className={cn(glass.glassSurface, glass.button, glass.generateButton)} disabled={busy || uploading || (!source && !data.layerizeRequestId)} onClick={() => generate(!!data.layerizeRequestId)}>
        <span className={cn(glass.glassContent, glass.buttonContent)}>{busy ? <Loader2 size={13} className={styles.spinner} /> : <Layers size={13} />}{busy ? 'Layerizing...' : data.layerizeRequestId ? 'Check status on FAL' : 'Layerize'}</span>
      </button>
      {layers.length > 0 && <button className={cn(glass.glassSurface, glass.button, glass.downloadButton)} disabled={downloading} onClick={() => download(true)}>
        <span className={cn(glass.glassContent, glass.buttonContent)}>{downloading ? <Loader2 size={13} className={styles.spinner} /> : <Download size={13} />}{downloading ? 'Preparing download...' : 'Download all layers (ZIP)'}</span>
      </button>}
    </div>
  </div>;
}
