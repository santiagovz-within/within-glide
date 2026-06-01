'use client';

import { useRef } from 'react';
import { Sparkles, Upload, X, AlertTriangle } from 'lucide-react';
import { useChatStore } from '@/lib/stores/chatStore';
import { IMAGE_MODELS, VIDEO_MODELS, MODELS } from '@/lib/api/models';
import { ASPECT_RATIOS, ACCEPTED_IMAGE_TYPES } from '@/lib/utils/constants';

const RESOLUTIONS = ['1K', '2K', '4K'] as const;
const DURATIONS   = [3, 5, 8, 10] as const;
const GEN_COUNTS  = [1, 2, 3, 4]  as const;

// Segment button style — used for resolution, duration, count toggles
function segBtn(active: boolean): React.CSSProperties {
  return {
    padding: '5px 10px', fontSize: 11, fontWeight: 700, letterSpacing: '0.065em',
    background: active ? 'rgba(255,255,255,0.12)' : 'transparent',
    color: active ? 'var(--color-white)' : 'var(--color-white-muted)',
    cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap' as const,
  };
}

// Pill <select> style
const SELECT_STYLE: React.CSSProperties = {
  padding: '5px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
  letterSpacing: '0.065em', cursor: 'pointer', outline: 'none',
  background: 'rgba(255,255,255,0.07)',
  border: '1px solid rgba(255,255,255,0.1)',
  color: 'var(--color-white)', whiteSpace: 'nowrap' as const,
};

// Segmented-pill wrapper
const SEG_WRAP: React.CSSProperties = {
  display: 'flex', flexShrink: 0, borderRadius: 999, overflow: 'hidden',
  border: '1px solid rgba(255,255,255,0.1)',
};

const DIVIDER: React.CSSProperties = {
  width: 1, height: 16, background: 'rgba(255,255,255,0.1)',
  flexShrink: 0, margin: '0 2px',
};

interface ChatInputProps {
  onSubmit: () => void;
}

export function ChatInput({ onSubmit }: ChatInputProps) {
  const {
    mode, setMode,
    prompt, setPrompt,
    referenceImages, addReferenceImage, removeReferenceImage,
    settings, updateSettings,
    isGenerating,
  } = useChatStore();

  const fileInputRef   = useRef<HTMLInputElement>(null);
  const textareaRef    = useRef<HTMLTextAreaElement>(null);

  const models        = mode === 'image' ? IMAGE_MODELS : VIDEO_MODELS;
  const currentModel  = MODELS[settings.model];
  const isSeedance    = settings.model === 'seedance-2';

  // Aspect ratios for current model (fall back to full list)
  const validAspects = currentModel?.supportedAspectRatios?.length
    ? ASPECT_RATIOS.filter(r => (currentModel.supportedAspectRatios as readonly string[]).includes(r.value))
    : ASPECT_RATIOS;

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const { url } = await res.json();
      if (url) addReferenceImage(url);
    }
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

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !isGenerating) onSubmit();
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

        {/* ── Controls row ─────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px 8px', flexWrap: 'wrap' }}>

          {/* Mode: IMAGE | VIDEO */}
          <div style={SEG_WRAP}>
            {(['image', 'video'] as const).map((m, i) => (
              <button key={m} onClick={() => setMode(m)} style={{
                ...segBtn(mode === m),
                borderRight: i === 0 ? '1px solid rgba(255,255,255,0.1)' : 'none',
              }}>
                {m === 'image' ? 'IMAGE' : 'VIDEO'}
              </button>
            ))}
          </div>

          <div style={DIVIDER} />

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
                  minWidth: 28, justifyContent: 'center',
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

          {/* Seedance cost warning */}
          {isSeedance && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
              fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 999,
              background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)', color: '#eab308',
            }}>
              <AlertTriangle size={9} />
              Expensive
            </span>
          )}

          <div style={{ flex: 1 }} />

          {/* Upload reference / start frame */}
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
              padding: '5px 11px', borderRadius: 999, fontSize: 11, fontWeight: 700,
              letterSpacing: '0.065em', cursor: 'pointer', whiteSpace: 'nowrap',
              background: 'transparent', border: '1px solid transparent',
              color: 'var(--color-white-muted)', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.border = '1px solid rgba(255,255,255,0.1)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.border = '1px solid transparent'; }}
          >
            <Upload size={11} />
            {mode === 'image' ? 'REF IMAGE' : 'START FRAME'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={Object.keys(ACCEPTED_IMAGE_TYPES).join(',')}
            multiple={mode === 'image'}
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '0 12px' }} />

        {/* ── Prompt row ───────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px' }}>

          {/* Reference image thumbnails */}
          {referenceImages.map(url => (
            <div key={url} style={{ position: 'relative', flexShrink: 0, width: 32, height: 32, borderRadius: 8, overflow: 'hidden' }}>
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

          {/* Prompt */}
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
            onKeyDown={handleKeyDown}
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
