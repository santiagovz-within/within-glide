'use client';

import { useRef, useState } from 'react';
import { Sparkles, Upload, X, AlertTriangle, Loader2 } from 'lucide-react';
import { useChatStore } from '@/lib/stores/chatStore';
import { IMAGE_MODELS, VIDEO_MODELS, MODELS } from '@/lib/api/models';
import { ASPECT_RATIOS, ACCEPTED_IMAGE_TYPES } from '@/lib/utils/constants';
import { processImageFile } from '@/lib/utils/imageProcessing';

const RESOLUTIONS = ['1K', '2K', '4K'] as const;
const DURATIONS   = [3, 5, 8, 10] as const;
const GEN_COUNTS  = [1, 2, 3, 4]  as const;

function segBtn(active: boolean): React.CSSProperties {
  return {
    padding: '5px 10px', fontSize: 11, fontWeight: 700, letterSpacing: '0.065em',
    background: active ? 'rgba(255,255,255,0.12)' : 'transparent',
    color: active ? 'var(--color-white)' : 'var(--color-white-muted)',
    cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap' as const,
  };
}

const SELECT_STYLE: React.CSSProperties = {
  padding: '5px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
  letterSpacing: '0.065em', cursor: 'pointer', outline: 'none',
  background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)',
  color: 'var(--color-white)',
};

const SEG_WRAP: React.CSSProperties = {
  display: 'flex', flexShrink: 0, borderRadius: 999, overflow: 'hidden',
  border: '1px solid rgba(255,255,255,0.1)',
};

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

  const models        = mode === 'image' ? IMAGE_MODELS : VIDEO_MODELS;
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
    next.splice(slot, 1);
    setReferenceImages(next.filter(Boolean));
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

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '0 12px 12px', background: 'var(--color-bg-darkest)' }}>
      <div style={{
        borderRadius: 18,
        background: 'rgba(14,14,18,0.95)',
        backdropFilter: 'blur(28px)',
        WebkitBackdropFilter: 'blur(28px)',
        border: '1px solid rgba(255,255,255,0.09)',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.3)',
      }}>

        {/* ── Controls row ──────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px 8px', flexWrap: 'wrap' }}>

          {/* IMAGE | VIDEO mode toggle */}
          <div style={SEG_WRAP}>
            {(['image', 'video'] as const).map((m, i) => (
              <button key={m} onClick={() => { setMode(m); setReferenceImages([]); }} style={{
                ...segBtn(mode === m),
                borderRight: i === 0 ? '1px solid rgba(255,255,255,0.1)' : 'none',
              }}>
                {m === 'image' ? 'IMAGE' : 'VIDEO'}
              </button>
            ))}
          </div>

          <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)', flexShrink: 0, margin: '0 2px' }} />

          {/* Model */}
          <select value={settings.model} onChange={e => handleModelChange(e.target.value)} style={SELECT_STYLE}>
            {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>

          {/* Aspect ratio */}
          <select value={settings.aspectRatio} onChange={e => updateSettings({ aspectRatio: e.target.value })} style={SELECT_STYLE}>
            {validAspects.map(r => <option key={r.value} value={r.value}>{r.value}</option>)}
          </select>

          {/* Resolution (image only) */}
          {mode === 'image' && (
            <div style={SEG_WRAP}>
              {RESOLUTIONS.map((r, i) => (
                <button key={r} onClick={() => updateSettings({ resolution: r })} style={{
                  ...segBtn(settings.resolution === r),
                  borderRight: i < RESOLUTIONS.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none',
                }}>
                  {r}
                </button>
              ))}
            </div>
          )}

          {/* Num images (image only) */}
          {mode === 'image' && (
            <div style={SEG_WRAP}>
              {GEN_COUNTS.map((n, i) => (
                <button key={n} onClick={() => updateSettings({ numGenerations: n })} style={{
                  ...segBtn(settings.numGenerations === n),
                  minWidth: 28, justifyContent: 'center' as const,
                  borderRight: i < GEN_COUNTS.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none',
                }}>
                  {n}
                </button>
              ))}
            </div>
          )}

          {/* Duration (video only) */}
          {mode === 'video' && (
            <div style={SEG_WRAP}>
              {DURATIONS.map((d, i) => (
                <button key={d} onClick={() => updateSettings({ duration: d })} style={{
                  ...segBtn(settings.duration === d),
                  borderRight: i < DURATIONS.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none',
                }}>
                  {d}s
                </button>
              ))}
            </div>
          )}

          {/* Seedance warning */}
          {isSeedance && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
              fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 999,
              background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)', color: '#eab308',
            }}>
              <AlertTriangle size={9} /> Expensive
            </span>
          )}

          <div style={{ flex: 1 }} />

          {/* Upload button — image mode only (video uses the frame slots below) */}
          {mode === 'image' && (
            <>
              <button
                onClick={() => fileImageRef.current?.click()}
                disabled={isUploading}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
                  padding: '5px 11px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                  letterSpacing: '0.065em', cursor: isUploading ? 'wait' : 'pointer',
                  background: 'transparent', border: '1px solid transparent',
                  color: 'var(--color-white-muted)', transition: 'all 0.15s',
                }}
                onMouseEnter={e => { if (!isUploading) { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.border = '1px solid rgba(255,255,255,0.1)'; }}}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.border = '1px solid transparent'; }}
              >
                {imgUploadingCount > 0
                  ? <><Loader2 size={11} className="animate-spin" /> Uploading {imgUploadingCount}…</>
                  : <><Upload size={11} /> ADD IMAGES</>
                }
              </button>
              <input
                ref={fileImageRef}
                type="file"
                accept={Object.keys(ACCEPTED_IMAGE_TYPES).join(',')}
                multiple
                style={{ display: 'none' }}
                onChange={handleImageFilesChange}
              />
            </>
          )}
        </div>

        {/* ── Video frame slots ──────────────────────────────────────────── */}
        {mode === 'video' && (
          <div style={{ display: 'flex', gap: 8, padding: '0 12px 8px' }}>
            {([0, 1] as const).map(slot => {
              const label = slot === 0 ? 'START FRAME' : 'END FRAME';
              const fileRef = slot === 0 ? fileStartRef : fileEndRef;
              const url = referenceImages[slot];
              const uploading = videoUploadingSlots.has(slot);

              return (
                <div key={slot} style={{ flex: 1 }}>
                  <input
                    ref={fileRef}
                    type="file"
                    accept={Object.keys(ACCEPTED_IMAGE_TYPES).join(',')}
                    style={{ display: 'none' }}
                    onChange={e => handleVideoFrameChange(e, slot)}
                  />
                  <button
                    onClick={() => !url && fileRef.current?.click()}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      height: 52, borderRadius: 10, fontSize: 10, fontWeight: 700,
                      letterSpacing: '0.07em', cursor: url ? 'default' : 'pointer',
                      border: url ? 'none' : '1px dashed rgba(255,255,255,0.18)',
                      background: url ? 'transparent' : 'rgba(255,255,255,0.03)',
                      color: 'var(--color-white-muted)', overflow: 'hidden', position: 'relative',
                      transition: 'border-color 0.15s',
                    }}
                    onMouseEnter={e => { if (!url) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)'; }}
                    onMouseLeave={e => { if (!url) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)'; }}
                  >
                    {uploading ? (
                      <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
                    ) : url ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        <div style={{
                          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                          alignItems: 'center', justifyContent: 'center', gap: 4,
                          background: 'rgba(0,0,0,0.45)', opacity: 0,
                          transition: 'opacity 0.15s',
                        }}
                          onMouseEnter={e => { e.currentTarget.style.opacity = '1'; }}
                          onMouseLeave={e => { e.currentTarget.style.opacity = '0'; }}
                        >
                          <button
                            onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}
                            style={{ fontSize: 9, fontWeight: 700, color: '#fff', letterSpacing: '0.06em', background: 'none', border: 'none', cursor: 'pointer' }}
                          >
                            REPLACE
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); clearVideoSlot(slot); }}
                            style={{ padding: '2px 6px', borderRadius: 4, background: 'rgba(239,68,68,0.7)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}
                          >
                            <X size={9} style={{ color: '#fff' }} />
                          </button>
                        </div>
                        <span style={{
                          position: 'absolute', bottom: 4, left: 0, right: 0, textAlign: 'center',
                          fontSize: 9, fontWeight: 700, letterSpacing: '0.07em',
                          color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.8)',
                        }}>
                          {label}
                        </span>
                      </>
                    ) : (
                      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                        <Upload size={12} />
                        <span style={{ fontSize: 9, letterSpacing: '0.07em' }}>{label}</span>
                        {slot === 1 && <span style={{ fontSize: 8, opacity: 0.5 }}>optional</span>}
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Error message ──────────────────────────────────────────────── */}
        {uploadError && (
          <div style={{ margin: '0 12px 8px', padding: '6px 10px', borderRadius: 8, fontSize: 11, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={11} />
            {uploadError}
            <button onClick={() => setUploadError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#f87171', cursor: 'pointer' }}>
              <X size={11} />
            </button>
          </div>
        )}

        {/* Divider */}
        <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '0 12px' }} />

        {/* ── Prompt row ──────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px' }}>

          {/* Image mode reference thumbnails */}
          {mode === 'image' && (referenceImages.length > 0 || imgUploadingCount > 0) && (
            <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
              {referenceImages.map(url => (
                <div key={url} style={{ position: 'relative', width: 30, height: 30, borderRadius: 6, overflow: 'hidden', flexShrink: 0 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  <button
                    onClick={() => removeReferenceImage(url)}
                    style={{ position: 'absolute', top: 0, right: 0, background: 'rgba(0,0,0,0.7)', borderRadius: '0 0 0 4px', padding: '2px', cursor: 'pointer', border: 'none', display: 'flex' }}
                  >
                    <X size={7} style={{ color: '#fff' }} />
                  </button>
                </div>
              ))}
              {/* Uploading placeholders */}
              {Array.from({ length: imgUploadingCount }).map((_, i) => (
                <div key={`uploading-${i}`} style={{ width: 30, height: 30, borderRadius: 6, flexShrink: 0, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Loader2 size={10} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
                </div>
              ))}
            </div>
          )}

          {/* Prompt textarea */}
          <textarea
            ref={textareaRef}
            rows={1}
            placeholder={`Describe your ${mode}…`}
            value={prompt}
            onChange={e => {
              setPrompt(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !isGenerating) onSubmit();
            }}
            style={{
              flex: 1, fontSize: 14, outline: 'none', background: 'transparent',
              border: 'none', color: 'var(--color-white)', padding: '2px 0',
              resize: 'none', overflow: 'hidden', minHeight: 24, maxHeight: 120,
            }}
          />

          {/* Enhance */}
          <button
            onClick={handleEnhance}
            disabled={!prompt.trim()}
            style={{ flexShrink: 0, padding: 4, borderRadius: 6, cursor: 'pointer', border: 'none', background: 'transparent', opacity: prompt.trim() ? 1 : 0.3, transition: 'opacity 0.15s' }}
            title="Enhance prompt"
          >
            <Sparkles size={14} style={{ color: 'var(--color-accent)', display: 'block' }} />
          </button>

          {/* Generate */}
          <button
            onClick={onSubmit}
            disabled={!prompt.trim() || isGenerating}
            style={{
              flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '6px 16px', borderRadius: 999, fontSize: 11, fontWeight: 700,
              letterSpacing: '0.065em', cursor: 'pointer', border: 'none', transition: 'opacity 0.15s',
              background: !prompt.trim() || isGenerating ? 'rgba(255,255,255,0.15)' : '#fff',
              color: !prompt.trim() || isGenerating ? 'var(--color-white-muted)' : '#000',
              opacity: !prompt.trim() || isGenerating ? 0.5 : 1,
            }}
          >
            {isGenerating ? 'Generating…' : 'GENERATE'}
          </button>
        </div>
      </div>
    </div>
  );
}
