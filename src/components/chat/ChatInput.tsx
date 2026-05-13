'use client';

import { Send, Sparkles, X, Image, Film } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { useCallback } from 'react';
import { useChatStore } from '@/lib/stores/chatStore';
import { IMAGE_MODELS, VIDEO_MODELS } from '@/lib/api/models';
import { ASPECT_RATIOS, ACCEPTED_IMAGE_TYPES } from '@/lib/utils/constants';
import { cn } from '@/lib/utils/cn';

const QUALITY_OPTIONS = ['Low', 'Medium', 'High'] as const;
const GEN_COUNTS = [1, 2, 3, 4] as const;

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

  const models = mode === 'image' ? IMAGE_MODELS : VIDEO_MODELS;

  const onDrop = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        const { url } = await res.json();
        if (url) addReferenceImage(url);
      }
    },
    [addReferenceImage]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_IMAGE_TYPES,
    maxSize: 20 * 1024 * 1024,
    noClick: true,
  });

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
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !isGenerating) {
      onSubmit();
    }
  }

  return (
    <div
      className="p-4"
      style={{
        borderTop: 'var(--border-default)',
        background: 'var(--color-bg-darkest)',
      }}
    >
      {/* Mode toggle */}
      <div className="flex items-center gap-2 mb-3">
        <div
          className="inline-flex rounded-lg p-0.5"
          style={{ background: 'var(--color-bg-surface)', border: 'var(--border-default)' }}
        >
          {(['image', 'video'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                mode === m ? 'shadow-sm' : 'opacity-60'
              )}
              style={{
                background: mode === m ? 'var(--color-bg-elevated)' : 'transparent',
                color: mode === m ? 'var(--color-white)' : 'var(--color-white-muted)',
              }}
            >
              {m === 'image' ? <Image size={12} /> : <Film size={12} />}
              {m === 'image' ? 'Image' : 'Video'}
            </button>
          ))}
        </div>
      </div>

      {/* Reference images */}
      <div className="mb-3">
        <div
          {...getRootProps()}
          className="flex flex-wrap gap-2 p-2.5 rounded-lg min-h-[52px]"
          style={{
            background: 'var(--color-bg-surface)',
            border: isDragActive ? '1.5px dashed var(--color-accent)' : 'var(--border-default)',
          }}
        >
          <input {...getInputProps()} />
          {referenceImages.length === 0 && (
            <span className="text-xs self-center" style={{ color: 'var(--color-white-muted)' }}>
              {mode === 'image' ? 'Drag reference images here...' : 'Drag start frame here...'}
            </span>
          )}
          {referenceImages.map((url) => (
            <div key={url} className="relative w-10 h-10 rounded-lg overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="w-full h-full object-cover" />
              <button
                className="absolute top-0 right-0 p-0.5 rounded-bl"
                style={{ background: 'rgba(0,0,0,0.6)' }}
                onClick={() => removeReferenceImage(url)}
              >
                <X size={8} style={{ color: '#fff' }} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Prompt textarea */}
      <div className="relative mb-3">
        <textarea
          className="w-full resize-none rounded-lg px-3 py-2.5 pr-10 text-sm outline-none transition-all"
          rows={3}
          placeholder="Describe your image or reference by using @..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{
            background: 'var(--color-bg-surface)',
            border: 'var(--border-default)',
            color: 'var(--color-white)',
          }}
        />
        <button
          onClick={handleEnhance}
          disabled={!prompt.trim()}
          className="absolute bottom-2.5 right-2.5 p-1 rounded transition-opacity hover:opacity-80 disabled:opacity-30"
          title="Enhance prompt with AI"
        >
          <Sparkles size={14} style={{ color: 'var(--color-accent)' }} />
        </button>
      </div>

      {/* Settings row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Model */}
        <select
          className="flex-1 min-w-[140px] px-2 py-1.5 rounded-lg text-xs outline-none"
          value={settings.model}
          onChange={(e) => updateSettings({ model: e.target.value })}
          style={{ background: 'var(--color-bg-surface)', border: 'var(--border-default)', color: 'var(--color-white)' }}
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>

        {/* Aspect ratio */}
        <select
          className="px-2 py-1.5 rounded-lg text-xs outline-none"
          value={settings.aspectRatio}
          onChange={(e) => updateSettings({ aspectRatio: e.target.value })}
          style={{ background: 'var(--color-bg-surface)', border: 'var(--border-default)', color: 'var(--color-white)' }}
        >
          {ASPECT_RATIOS.map((r) => (
            <option key={r.value} value={r.value}>{r.value}</option>
          ))}
        </select>

        {/* Quality */}
        <select
          className="px-2 py-1.5 rounded-lg text-xs outline-none"
          value={settings.quality}
          onChange={(e) => updateSettings({ quality: e.target.value })}
          style={{ background: 'var(--color-bg-surface)', border: 'var(--border-default)', color: 'var(--color-white)' }}
        >
          {QUALITY_OPTIONS.map((q) => (
            <option key={q} value={q.toLowerCase()}>{q}</option>
          ))}
        </select>

        {/* Num generations (image only) */}
        {mode === 'image' && (
          <div className="flex gap-1">
            {GEN_COUNTS.map((n) => (
              <button
                key={n}
                onClick={() => updateSettings({ numGenerations: n })}
                className="w-7 h-7 rounded-lg text-xs font-medium transition-colors"
                style={{
                  background: settings.numGenerations === n ? '#fff' : 'var(--color-bg-surface)',
                  color: settings.numGenerations === n ? '#000' : 'var(--color-white-muted)',
                  border: 'var(--border-default)',
                }}
              >
                {n}
              </button>
            ))}
          </div>
        )}

        {/* Generate button */}
        <button
          onClick={onSubmit}
          disabled={!prompt.trim() || isGenerating}
          className="ml-auto flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-opacity disabled:opacity-40"
          style={{ background: '#fff', color: '#000' }}
        >
          <Send size={14} />
          {isGenerating ? 'Generating...' : 'Generate'}
        </button>
      </div>
    </div>
  );
}
