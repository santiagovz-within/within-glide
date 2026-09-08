'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { Sparkles, Plus, Minus, ImagePlus, Image as ImageIcon, Video, X, AlertTriangle, Loader2, Timer, Maximize } from 'lucide-react';
import { useChatStore } from '@/lib/stores/chatStore';
import { IMAGE_MODELS, CHAT_VIDEO_MODELS, MODELS } from '@/lib/api/models';
import { ASPECT_RATIOS, ACCEPTED_IMAGE_TYPES } from '@/lib/utils/constants';
import { processImageFile } from '@/lib/utils/imageProcessing';

import { ModelSelect } from '@/components/canvas/nodes/ModelSelect';
import { NodeSelect } from '@/components/canvas/nodes/NodeSelect';
import { AspectRatioGlyph } from '@/components/canvas/nodes/AspectRatioGlyph';
import { cn } from '@/lib/utils/cn';
import glass from '@/components/canvas/nodes/ImageGenerationGlass.module.css';
import styles from './ImageVideo.module.css';

const RESOLUTIONS = ['1K', '2K', '4K'] as const;
const DURATIONS   = [3, 5, 8, 10] as const;
interface ChatInputProps {
  onSubmit: () => void;
}

export function ChatInput({ onSubmit }: ChatInputProps) {
  const {
    mode, setMode,
    prompt, setPrompt,
    referenceImages, setReferenceImages, addReferenceImage, removeReferenceImage,
    settings, updateSettings,
    isGenerating,
  } = useChatStore();

  // Uploading state: count for image mode, slot-specific for video mode
  const [imgUploadingCount, setImgUploadingCount] = useState(0);
  const [videoUploadingSlots, setVideoUploadingSlots] = useState<Set<0 | 1>>(new Set());
  const [uploadError, setUploadError] = useState<string | null>(null);

  const fileImageRef = useRef<HTMLInputElement>(null);
  const fileStartRef = useRef<HTMLInputElement>(null);
  const fileEndRef   = useRef<HTMLInputElement>(null);
  const textareaRef  = useRef<HTMLTextAreaElement>(null);

  const models        = mode === 'image' ? IMAGE_MODELS : CHAT_VIDEO_MODELS;
  const currentModel  = MODELS[settings.model];
  const isSeedance    = settings.model === 'seedance-2';

  const validAspects = currentModel?.supportedAspectRatios?.length
    ? ASPECT_RATIOS.filter(r => (currentModel.supportedAspectRatios as readonly string[]).includes(r.value))
    : ASPECT_RATIOS;

  // ── Shared upload pipeline: validate → compress → POST ──────────────────────
  async function uploadFile(file: File): Promise<string | null> {
    setUploadError(null);
    const processed = await processImageFile(file, () => {});
    const formData = new FormData();
    formData.append('file', processed);
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    if (!res.ok) throw new Error('Upload failed');
    const { url } = await res.json();
    return url ?? null;
  }

  // ── Image mode: multi-file reference images ──────────────────────────────────
  async function handleImageFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;
    setImgUploadingCount(c => c + files.length);
    await Promise.all(files.map(async (file) => {
      try {
        const url = await uploadFile(file);
        if (url) addReferenceImage(url);
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setImgUploadingCount(c => Math.max(0, c - 1));
      }
    }));
  }

  // ── Video mode: slot-specific frame upload ───────────────────────────────────
  async function handleVideoFrameChange(e: React.ChangeEvent<HTMLInputElement>, slot: 0 | 1) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setVideoUploadingSlots(prev => new Set([...prev, slot]));
    try {
      const url = await uploadFile(file);
      if (url) {
        const next = [...referenceImages];
        next[slot] = url;
        setReferenceImages(next);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setVideoUploadingSlots(prev => { const n = new Set(prev); n.delete(slot); return n; });
    }
  }

  function clearVideoSlot(slot: 0 | 1) {
    const next = [...referenceImages];
    next[slot] = '';
    setReferenceImages(next);
  }

  async function handleEnhance() {
    if (!prompt.trim()) return;
    const res = await fetch('/api/google/enhance-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, mediaType: mode, modelName: settings.model }),
    });
    const { enhancedPrompt } = await res.json();
    if (enhancedPrompt) setPrompt(enhancedPrompt);
  }

  function handleModelChange(newModel: string) {
    const newConfig = MODELS[newModel];
    const updates: Partial<typeof settings> = { model: newModel };
    if (
      newConfig?.supportedAspectRatios?.length &&
      !(newConfig.supportedAspectRatios as readonly string[]).includes(settings.aspectRatio)
    ) {
      updates.aspectRatio = newConfig.supportedAspectRatios[0];
    }
    updateSettings(updates);
  }

  const isUploading = imgUploadingCount > 0 || videoUploadingSlots.size > 0;
  const canGenerate = !!prompt.trim() && !isGenerating && !isUploading;

  useLayoutEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
  }, [prompt]);

  return (
    <div className={cn(glass.nodeShell, glass.nodeSurface, glass.glassSurface, styles.composer)}>
      <div className={styles.promptRow}>
        <button
          className={cn(glass.glassSurface, styles.iconButton)}
          onClick={() => mode === 'image' ? fileImageRef.current?.click() : fileStartRef.current?.click()}
          disabled={isUploading}
          title={mode === 'image' ? 'Add images' : 'Add start frame'}
          aria-label={mode === 'image' ? 'Add images' : 'Add start frame'}
        >
          {isUploading ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
        </button>
        <input ref={fileImageRef} type="file" accept={Object.keys(ACCEPTED_IMAGE_TYPES).join(',')} multiple hidden onChange={handleImageFilesChange} />
        <textarea
          ref={textareaRef}
          rows={1}
          aria-label="Prompt"
          placeholder={`Describe your ${mode}...`}
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (canGenerate) onSubmit();
            }
          }}
          className={styles.prompt}
        />
      </div>

      {mode === 'image' && (referenceImages.length > 0 || imgUploadingCount > 0) && (
        <div className={styles.references}>
          {referenceImages.map((url, index) => (
            <div key={`${url}-${index}`} className={styles.reference}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Reference ${index + 1}`} />
              <button onClick={() => removeReferenceImage(url)} title="Remove reference" aria-label={`Remove reference ${index + 1}`}><X size={11} /></button>
            </div>
          ))}
          {Array.from({ length: imgUploadingCount }, (_, index) => (
            <div key={index} className={styles.reference}><Loader2 size={16} className="animate-spin" /></div>
          ))}
        </div>
      )}

      {mode === 'video' && (
        <div className={styles.references}>
          {([0, 1] as const).map(slot => {
            const label = slot === 0 ? 'Start frame' : 'End frame';
            const fileRef = slot === 0 ? fileStartRef : fileEndRef;
            const url = referenceImages[slot];
            return (
              <div key={slot} className={styles.frame}>
                <input ref={fileRef} type="file" accept={Object.keys(ACCEPTED_IMAGE_TYPES).join(',')} hidden onChange={e => handleVideoFrameChange(e, slot)} />
                <button className={cn(glass.glassSurface, styles.frameButton)} onClick={() => fileRef.current?.click()} disabled={videoUploadingSlots.has(slot)} title={url ? `Replace ${label.toLowerCase()}` : label}>
                  {videoUploadingSlots.has(slot) ? <Loader2 size={16} className="animate-spin" /> : url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt={label} />
                  ) : <ImagePlus size={16} />}
                  <span>{label}{slot === 1 && !url ? ' (optional)' : ''}</span>
                </button>
                {url && <button className={styles.removeFrame} onClick={() => clearVideoSlot(slot)} title={`Remove ${label.toLowerCase()}`} aria-label={`Remove ${label.toLowerCase()}`}><X size={12} /></button>}
              </div>
            );
          })}
        </div>
      )}

      {uploadError && (
        <div className={styles.error} role="alert">
          <AlertTriangle size={14} /><span>{uploadError}</span>
          <button onClick={() => setUploadError(null)} aria-label="Dismiss error"><X size={14} /></button>
        </div>
      )}

      <div className={styles.controls}>
        <div className={cn(glass.glassSurface, styles.modeToggle)} role="group" aria-label="Media type">
          {(['image', 'video'] as const).map(m => (
            <button key={m} onClick={() => { if (mode !== m) setMode(m); }} aria-pressed={mode === m} title={m === 'image' ? 'Image' : 'Video'} aria-label={m === 'image' ? 'Image' : 'Video'}>
              {m === 'image' ? <ImageIcon size={15} /> : <Video size={15} />}
            </button>
          ))}
        </div>
        <div className={styles.model}>
          <ModelSelect standalone compact placement="top" options={models} value={settings.model} onChange={handleModelChange} />
        </div>
        <NodeSelect standalone placement="top" label="Aspect ratio" options={validAspects.map(r => r.value)} value={settings.aspectRatio} onChange={aspectRatio => updateSettings({ aspectRatio })} leadingIcon={<AspectRatioGlyph ratio={settings.aspectRatio} />} optionIcon={value => <AspectRatioGlyph ratio={value} />} />
        {mode === 'image' ? (
          <>
            <NodeSelect standalone placement="top" label="Resolution" options={[...RESOLUTIONS]} value={settings.resolution} onChange={resolution => updateSettings({ resolution: resolution as typeof settings.resolution })} leadingIcon={<Maximize size={12} />} />
            <div className={cn(glass.glassSurface, styles.stepper)} role="group" aria-label="Number of images">
              <button onClick={() => updateSettings({ numGenerations: settings.numGenerations - 1 })} disabled={settings.numGenerations <= 1} title="Fewer images" aria-label="Fewer images"><Minus size={13} /></button>
              <output aria-label="Image count">{settings.numGenerations}/4</output>
              <button onClick={() => updateSettings({ numGenerations: settings.numGenerations + 1 })} disabled={settings.numGenerations >= 4} title="More images" aria-label="More images"><Plus size={13} /></button>
            </div>
          </>
        ) : (
          <NodeSelect standalone placement="top" label="Duration" options={DURATIONS.map(d => `${d}s`)} value={`${settings.duration ?? 5}s`} onChange={duration => updateSettings({ duration: Number.parseInt(duration, 10) })} leadingIcon={<Timer size={12} />} />
        )}
        {isSeedance && <span className={styles.warning} title="Expensive model"><AlertTriangle size={13} />Expensive</span>}
        <div className={styles.actions}>
          <button className={cn(glass.glassSurface, styles.iconButton)} onClick={handleEnhance} disabled={!prompt.trim()} title="Enhance prompt" aria-label="Enhance prompt"><Sparkles size={15} /></button>
          <button className={cn(glass.glassSurface, glass.button, glass.generateButton, styles.generate)} onClick={onSubmit} disabled={!canGenerate}>
            <span className={cn(glass.glassContent, styles.generateContent)}>
              {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {isGenerating ? 'Generating...' : 'Generate'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
