'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Type, Star, Droplet, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import type { PromptNodeData, PaletteColor } from '@/types';

const GEMINI_MODELS = [
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash' },
  { id: 'gemini-3.1-flash-lite',  label: 'Gemini 3.1 Flash Lite' },
];

const LENGTH_OPTIONS = [
  { id: 'auto',   label: 'Auto' },
  { id: 'short',  label: 'Short' },
  { id: 'medium', label: 'Medium' },
  { id: 'long',   label: 'Long' },
];

const MAX_PALETTE_COLORS = 5;

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

function enrichWithPalette(prompt: string, palette: PaletteColor[]): string {
  const active = palette.filter(c => c.hex);
  if (!active.length) return prompt;
  let enriched = prompt;
  active.forEach((c, i) => {
    const ref = `@color${i + 1}`;
    if (enriched.includes(ref)) {
      const label = c.name ? `${c.name} (${c.hex})` : c.hex;
      enriched = enriched.replaceAll(ref, label);
    }
  });
  const paletteStr = active.map((c, i) => `${c.name || `color ${i + 1}`}: ${c.hex}`).join(', ');
  return `${enriched}\n\nColor palette — ${paletteStr}`;
}

export function PromptNode({ data, selected, id }: NodeProps & { data: PromptNodeData }) {
  const [enhancing, setEnhancing] = useState(false);
  const [geminiModel, setGeminiModel] = useState('gemini-3-flash-preview');
  const [length, setLength] = useState('auto');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const paletteEnabled = data.paletteEnabled ?? false;
  const palette: PaletteColor[] = data.palette ?? [];

  useEffect(() => {
    if (textareaRef.current) autoResize(textareaRef.current);
  }, [data.prompt]);

  function dispatchUpdate(updates: Partial<PromptNodeData>) {
    document.dispatchEvent(new CustomEvent('node:update', {
      detail: { nodeId: id, data: updates },
    }));
  }

  function propagatePrompt(rawPrompt: string) {
    const enriched = paletteEnabled && palette.length
      ? enrichWithPalette(rawPrompt, palette)
      : rawPrompt;
    document.dispatchEvent(new CustomEvent('node:prompt-propagate', {
      detail: { sourceNodeId: id, prompt: enriched },
    }));
  }

  function handlePromptChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    autoResize(e.target);
    const newPrompt = e.target.value;
    dispatchUpdate({ prompt: newPrompt });
    propagatePrompt(newPrompt);
  }

  // Re-propagate when palette settings change
  useEffect(() => {
    if (data.prompt) {
      const enriched = data.paletteEnabled && (data.palette ?? []).length
        ? enrichWithPalette(data.prompt, data.palette ?? [])
        : data.prompt;
      document.dispatchEvent(new CustomEvent('node:prompt-propagate', {
        detail: { sourceNodeId: id, prompt: enriched },
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.paletteEnabled, data.palette]);

  async function handleEnhance() {
    if (!data.prompt?.trim() || enhancing) return;
    setEnhancing(true);
    try {
      const res = await fetch('/api/google/enhance-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: data.prompt, geminiModel, length }),
      });
      const { enhancedPrompt } = await res.json();
      if (enhancedPrompt) {
        dispatchUpdate({ prompt: enhancedPrompt });
        propagatePrompt(enhancedPrompt);
      }
    } finally {
      setEnhancing(false);
    }
  }

  function updatePaletteColor(index: number, updates: Partial<PaletteColor>) {
    const newPalette = [...palette];
    newPalette[index] = { ...newPalette[index], ...updates };
    dispatchUpdate({ palette: newPalette });
  }

  function addColor() {
    if (palette.length >= MAX_PALETTE_COLORS) return;
    dispatchUpdate({ palette: [...palette, { name: '', hex: '#ffffff' }] });
  }

  function removeColor(index: number) {
    dispatchUpdate({ palette: palette.filter((_, i) => i !== index) });
  }

  const selectStyle: React.CSSProperties = {
    background: 'var(--color-bg-surface)',
    border: 'none',
    color: 'var(--color-white)',
    borderRadius: 11,
  };

  return (
    <NodeWrapper title="Prompt" icon={<Type size={14} />} selected={selected} accentColor={PORT_COLORS.text}>
      <textarea
        ref={textareaRef}
        className="w-full text-xs outline-none nodrag mb-2"
        rows={2}
        placeholder="Write your prompt here…"
        value={data.prompt ?? ''}
        onChange={handlePromptChange}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--color-white)',
          resize: 'none',
          overflow: 'hidden',
          minHeight: 40,
        }}
      />

      {/* Model + length selectors */}
      <div className="grid grid-cols-2 gap-1.5 mb-2">
        <select
          value={geminiModel}
          onChange={(e) => setGeminiModel(e.target.value)}
          className="w-full px-2 py-1.5 text-xs outline-none nodrag"
          style={selectStyle}
        >
          {GEMINI_MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        <select
          value={length}
          onChange={(e) => setLength(e.target.value)}
          className="w-full px-2 py-1.5 text-xs outline-none nodrag"
          style={selectStyle}
        >
          {LENGTH_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      </div>

      <div className="flex gap-1.5 mb-0">
        <button
          onClick={handleEnhance}
          disabled={enhancing || !data.prompt?.trim()}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-opacity disabled:opacity-40 nodrag"
          style={{ background: '#fff', color: '#000', borderRadius: 11 }}
        >
          <Star size={11} className={enhancing ? 'animate-pulse' : ''} />
          {enhancing ? 'Enhancing…' : 'Enhance'}
        </button>
        <button
          onClick={() => dispatchUpdate({ paletteEnabled: !paletteEnabled })}
          className="flex items-center justify-center px-2.5 py-2 text-xs font-medium transition-colors nodrag"
          title="Color palette"
          style={{
            background: paletteEnabled ? 'var(--color-accent)' : 'var(--color-bg-surface)',
            color: paletteEnabled ? '#fff' : 'var(--color-white-muted)',
            borderRadius: 11,
          }}
        >
          <Droplet size={12} />
        </button>
      </div>

      {/* Color palette */}
      {paletteEnabled && (
        <div className="mt-2">
          {palette.map((color, i) => (
            <div key={i} className="flex items-center gap-1.5 mb-1.5">
              <input
                type="color"
                value={color.hex}
                onChange={(e) => updatePaletteColor(i, { hex: e.target.value })}
                className="nodrag"
                style={{ width: 24, height: 24, border: 'none', borderRadius: 6, padding: 0, cursor: 'pointer', flexShrink: 0 }}
              />
              <input
                type="text"
                value={color.name}
                onChange={(e) => updatePaletteColor(i, { name: e.target.value })}
                placeholder={`@color${i + 1}`}
                className="flex-1 text-xs outline-none nodrag"
                style={{
                  background: 'var(--color-bg-surface)',
                  border: 'none',
                  color: 'var(--color-white)',
                  borderRadius: 8,
                  padding: '3px 8px',
                  height: 24,
                  minWidth: 0,
                }}
              />
              <button
                onClick={() => removeColor(i)}
                className="nodrag shrink-0"
                style={{ color: 'var(--color-white-muted)', padding: '2px' }}
              >
                <X size={11} />
              </button>
            </div>
          ))}
          {palette.length < MAX_PALETTE_COLORS && (
            <button
              onClick={addColor}
              className="flex items-center gap-1 mt-0.5 text-xs nodrag"
              style={{ color: 'var(--color-white-muted)' }}
            >
              <Plus size={11} />
              Add color
            </button>
          )}
        </div>
      )}

      <TypedHandle type="source" position={Position.Right} id="prompt" portType="text" />
    </NodeWrapper>
  );
}
