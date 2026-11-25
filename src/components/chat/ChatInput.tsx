'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { Sparkles, Plus, Minus, ImagePlus, Image as ImageIcon, Video, X, AlertTriangle, Loader2, Timer, Maximize } from 'lucide-react';
import { useChatStore } from '@/lib/stores/chatStore';
import { IMAGE_MODELS, VIDEO_MODELS, MODELS } from '@/lib/api/models';
import { ACCEPTED_IMAGE_TYPES } from '@/lib/utils/constants';
import { processImageFile } from '@/lib/utils/imageProcessing';
import { getVideoGenerationSettings } from '@/lib/videoGenerationSettings';
import { useFalCostEstimateValue } from '@/lib/useFalCostEstimate';
import { formatFalCostEstimate } from '@/lib/falPricing';
import { ExpensiveGenerationDialog } from '@/components/canvas/nodes/ExpensiveGenerationDialog';
import { SeedanceDraftToggle } from '@/components/canvas/nodes/SeedanceDraftControls';

import { ModelSelect } from '@/components/canvas/nodes/ModelSelect';
import { NodeSelect } from '@/components/canvas/nodes/NodeSelect';
import { AspectRatioGlyph } from '@/components/canvas/nodes/AspectRatioGlyph';
import { cn } from '@/lib/utils/cn';
import glass from '@/components/canvas/nodes/ImageGenerationGlass.module.css';
import styles from './ImageVideo.module.css';

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

  const models = mode === 'image' ? IMAGE_MODELS : VIDEO_MODELS;
  const currentModel = MODELS[settings.model];
  const video = getVideoGenerationSettings({ ...settings, startFrameUrl: referenceImages[0] });
  const isSeedance = mode === 'video' && ['seedance-2', 'seedance-2-5'].includes(settings.model);
  const [confirmingCost, setConfirmingCost] = useState(false);
  const estimatedCost = useFalCostEstimateValue(mode === 'video' ? {
    endpoint: video.endpoint, aspectRatio: settings.aspectRatio, resolution: video.resolution,
    duration: video.duration, generateAudio: settings.generateAudio ?? true,
  } : null);
  const validAspects = currentModel?.supportedAspectRatios ?? [];
  const inputWarning = mode === 'video' && video.supportsEndFrame && referenceImages[1] && !referenceImages[0]
    ? 'Add a start frame to use an end frame.' : undefined;

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
        const latest = useChatStore.getState();
        if (latest.mode !== 'video') return;
        const next = [...latest.referenceImages];
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
      body: JSON.stringify({ prompt, mediaType: mode, modelName: settings.model, sourceType: 'chat' }),
    });
    const { enhancedPrompt } = await res.json();
    if (enhancedPrompt) setPrompt(enhancedPrompt);
  }

  function handleModelChange(model: string) {
    updateSettings({ model });
  }

  const isUploading = imgUploadingCount > 0 || videoUploadingSlots.size > 0;
  const canGenerate = !!prompt.trim() && !isGenerating && !isUploading && !inputWarning;
  function submit() {
    if (!canGenerate) return;
    if (isSeedance && estimatedCost !== null && estimatedCost > 8) setConfirmingCost(true);
    else onSubmit();
  }

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const resize = () => {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 140)}px`;
    };
    resize();
    let width = textarea.clientWidth;
    const observer = new ResizeObserver(() => {
      if (textarea.clientWidth === width) return;
      width = textarea.clientWidth;
      resize();
    });
    observer.observe(textarea);
    return () => observer.disconnect();
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
              submit();
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
          {([0, 1] as const).filter(slot => slot === 0 || video.supportsEndFrame).map(slot => {
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

      {mode === 'video' && (video.supportsAudio || settings.model === 'seedance-2-5') && (
        <div className={styles.videoOptions}>
          {settings.model === 'seedance-2-5' && <SeedanceDraftToggle enabled={video.draftMode} disabled={isGenerating}
            onChange={draftMode => updateSettings({ draftMode })} />}
          {video.supportsAudio && <div className={styles.audioOption}>
            <span>Generate audio</span>
            <button type="button" aria-label="Generate audio" aria-pressed={settings.generateAudio ?? true}
              onClick={() => updateSettings({ generateAudio: !(settings.generateAudio ?? true) })}
              className={cn(glass.glassSurface, glass.switch, (settings.generateAudio ?? true) && glass.switchOn)}>
              <span className={cn(glass.glassContent, glass.switchKnob)} />
            </button>
          </div>}
        </div>
      )}
      {inputWarning && <p className={styles.warning} role="status">{inputWarning}</p>}
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
          <ModelSelect standalone size="large" compact placement="top" options={models} value={settings.model} onChange={handleModelChange} />
        </div>
        <NodeSelect standalone size="large" placement="top" label="Aspect ratio" options={validAspects} value={mode === 'video' && video.followsInputAspect ? 'From start frame' : settings.aspectRatio} locked={mode === 'video' && video.followsInputAspect} onChange={aspectRatio => updateSettings({ aspectRatio })} leadingIcon={<AspectRatioGlyph ratio={settings.aspectRatio} />} optionIcon={value => <AspectRatioGlyph ratio={value} />} />
        {mode === 'image' ? (
          <>
            <NodeSelect standalone size="large" placement="top" label="Resolution" options={currentModel?.supportedResolutions ?? ['1K']} value={settings.resolution} onChange={resolution => updateSettings({ resolution: resolution as typeof settings.resolution })} leadingIcon={<Maximize size={12} />} />
            <div className={cn(glass.glassSurface, styles.stepper)} role="group" aria-label="Number of images">
              <button onClick={() => updateSettings({ numGenerations: settings.numGenerations - 1 })} disabled={settings.numGenerations <= 1} title="Fewer images" aria-label="Fewer images"><Minus size={13} /></button>
              <output aria-label="Image count">{settings.numGenerations}/4</output>
              <button onClick={() => updateSettings({ numGenerations: settings.numGenerations + 1 })} disabled={settings.numGenerations >= 4} title="More images" aria-label="More images"><Plus size={13} /></button>
            </div>
          </>
        ) : (
          <>
            <NodeSelect standalone size="large" placement="top" label="Duration" options={video.durations.map(d => `${d}s`)} value={`${video.duration}s`} onChange={duration => updateSettings({ duration: Number.parseInt(duration, 10) })} leadingIcon={<Timer size={12} />} />
            <NodeSelect standalone size="large" placement="top" label="Video resolution" options={video.resolutions} value={video.resolution} locked={!!video.lockedResolution}
              onChange={videoResolution => updateSettings({ videoResolution: videoResolution as typeof settings.videoResolution })} leadingIcon={<Maximize size={12} />} />
          </>
        )}
        {isSeedance && estimatedCost !== null && estimatedCost > 8 && <span className={styles.warning} title="Estimated cost exceeds $8"><AlertTriangle size={13} />Expensive</span>}
        <div className={styles.actions}>
          <button className={cn(glass.glassSurface, styles.iconButton)} onClick={handleEnhance} disabled={!prompt.trim()} title="Enhance prompt" aria-label="Enhance prompt"><Sparkles size={15} /></button>
          <button className={cn(glass.glassSurface, glass.button, glass.generateButton, styles.generate)} onClick={submit} disabled={!canGenerate}>
            <span className={cn(glass.glassContent, styles.generateContent)}>
              {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {isGenerating ? 'Generating...' : mode === 'video' && video.draftMode ? 'Generate draft' : 'Generate'}
              {mode === 'video' && estimatedCost !== null && <span>{formatFalCostEstimate(estimatedCost)}</span>}
            </span>
          </button>
        </div>
      </div>
      {confirmingCost && estimatedCost !== null && <ExpensiveGenerationDialog estimatedCostUsd={estimatedCost}
        onCancel={() => setConfirmingCost(false)} onConfirm={() => { setConfirmingCost(false); if (canGenerate) onSubmit(); }} />}
    </div>
  );
}
