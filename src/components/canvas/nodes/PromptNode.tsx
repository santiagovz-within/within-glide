'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Type, Sunrise, Droplet, Plus, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useState } from 'react';
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
const LINE_H = '1.6';  // shared line-height for textarea + overlay

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

function hexToColorName(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) || 0;
  const g = parseInt(hex.slice(3, 5), 16) || 0;
  const b = parseInt(hex.slice(5, 7), 16) || 0;
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) {
    if (l < 0.12) return 'Black';
    if (l > 0.88) return 'White';
    return l < 0.4 ? 'Dark Gray' : l > 0.6 ? 'Light Gray' : 'Gray';
  }
  const d = max - min;
  let h = 0;
  if (max === rn)      h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else                 h = ((rn - gn) / d + 4) / 6;
  h = Math.round(h * 360);
  const shade = l < 0.28 ? 'Dark ' : l > 0.72 ? 'Light ' : '';
  if (h < 15 || h >= 345) return `${shade}Red`;
  if (h < 40)  return `${shade}Orange`;
  if (h < 65)  return `${shade}Yellow`;
  if (h < 80)  return `${shade}Yellow-Green`;
  if (h < 150) return `${shade}Green`;
  if (h < 175) return `${shade}Teal`;
  if (h < 200) return `${shade}Cyan`;
  if (h < 245) return `${shade}Blue`;
  if (h < 265) return `${shade}Indigo`;
  if (h < 290) return `${shade}Purple`;
  if (h < 325) return `${shade}Magenta`;
  return `${shade}Pink`;
}

function buildEnrichedPrompt(rawPrompt: string, palette: PaletteColor[]): string {
  const active = palette.filter(c => c.hex);
  if (!active.length) return rawPrompt;

  let enriched = rawPrompt;
  const untagged: PaletteColor[] = [];

  active.forEach((c, i) => {
    const ref = `@color${i + 1}`;
    if (rawPrompt.includes(ref)) {
      enriched = enriched.replaceAll(ref, `${hexToColorName(c.hex)} (Hex: ${c.hex})`);
    } else {
      untagged.push(c);
    }
  });

  if (untagged.length > 0) {
    const pool = untagged.map(c => `${hexToColorName(c.hex)} (Hex: ${c.hex})`).join(', ');
    enriched += `\n\nColor palette for background/secondary elements: ${pool}`;
  }

  return enriched;
}

// Tag navigation helpers — treat @colorN as an atomic unit in the textarea.
function tagAtPosition(text: string, pos: number, pal: PaletteColor[]): { ref: string; start: number; end: number } | null {
  for (let i = 0; i < pal.length; i++) {
    const ref = `@color${i + 1}`;
    let from = 0;
    while (true) {
      const idx = text.indexOf(ref, from);
      if (idx === -1) break;
      if (pos > idx && pos < idx + ref.length) return { ref, start: idx, end: idx + ref.length };
      from = idx + 1;
    }
  }
  return null;
}

function tagEndingAt(text: string, pos: number, pal: PaletteColor[]): { start: number } | null {
  for (let i = 0; i < pal.length; i++) {
    const ref = `@color${i + 1}`;
    const start = pos - ref.length;
    if (start >= 0 && text.slice(start, pos) === ref) return { start };
  }
  return null;
}

function tagStartingAt(text: string, pos: number, pal: PaletteColor[]): { end: number } | null {
  for (let i = 0; i < pal.length; i++) {
    const ref = `@color${i + 1}`;
    if (text.slice(pos, pos + ref.length) === ref) return { end: pos + ref.length };
  }
  return null;
}

// Overlay that renders @colorN refs as inline colored chips.
// pointer-events: none on container; × buttons get pointer-events: auto so they're clickable.
function ChipOverlay({
  text, palette, onRemoveRef,
}: { text: string; palette: PaletteColor[]; onRemoveRef: (ref: string) => void }) {
  const refs = palette.map((_, i) => `@color${i + 1}`);
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    let firstIdx = -1, firstRef = '', firstColorIdx = 0;
    for (let ci = 0; ci < refs.length; ci++) {
      const idx = remaining.indexOf(refs[ci]);
      if (idx >= 0 && (firstIdx === -1 || idx < firstIdx)) {
        firstIdx = idx; firstRef = refs[ci]; firstColorIdx = ci;
      }
    }

    if (firstIdx === -1) { parts.push(<span key={key++}>{remaining}</span>); break; }
    if (firstIdx > 0) parts.push(<span key={key++}>{remaining.slice(0, firstIdx)}</span>);

    const c = palette[firstColorIdx];
    const capturedRef = firstRef;
    // Chip: colored highlight with same font-size so it doesn't change line height.
    // × button gets pointer-events: auto to receive clicks through the overlay.
    parts.push(
      <span
        key={key++}
        style={{
          display: 'inline',
          background: c?.hex ? `${c.hex}28` : 'rgba(255,255,255,0.12)',
          color: c?.hex ?? 'var(--color-white)',
          borderRadius: 3,
          padding: '1px 3px 1px 6px',
          fontSize: 10,
        }}
      >
        {capturedRef}
        <button
          className="nodrag"
          style={{ display: 'inline', pointerEvents: 'auto', cursor: 'pointer', color: 'rgba(255,255,255,0.5)', fontSize: 10, paddingLeft: 2 }}
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onRemoveRef(capturedRef); }}
        >×</button>
      </span>
    );
    remaining = remaining.slice(firstIdx + firstRef.length);
  }

  return <>{parts}</>;
}

export function PromptNode({ data, selected, id }: NodeProps & { data: PromptNodeData }) {
  const [enhancing, setEnhancing] = useState(false);
  const [geminiModel, setGeminiModel] = useState('gemini-3-flash-preview');
  const [length, setLength] = useState('auto');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const paletteEnabled = data.paletteEnabled ?? false;
  const palette: PaletteColor[] = data.palette ?? [];
  const hasColorRefs = paletteEnabled && palette.some((_, i) => (data.prompt ?? '').includes(`@color${i + 1}`));

  useEffect(() => {
    if (textareaRef.current) autoResize(textareaRef.current);
  }, [data.prompt]);

  function dispatchUpdate(updates: Partial<PromptNodeData>) {
    document.dispatchEvent(new CustomEvent('node:update', { detail: { nodeId: id, data: updates } }));
  }

  function propagatePrompt(rawPrompt: string) {
    const enriched = paletteEnabled && palette.length
      ? buildEnrichedPrompt(rawPrompt, palette)
      : rawPrompt;
    document.dispatchEvent(new CustomEvent('node:prompt-propagate', { detail: { sourceNodeId: id, prompt: enriched } }));
  }

  function handlePromptChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    autoResize(e.target);
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart ?? newValue.length;
    dispatchUpdate({ prompt: newValue });
    propagatePrompt(newValue);
    // When the user just finished typing a complete tag, reaffirm cursor position
    // after React re-renders so the caret lands cleanly past the chip.
    if (paletteEnabled && palette.length && tagEndingAt(newValue, cursorPos, palette)) {
      const ta = e.target;
      setTimeout(() => ta.setSelectionRange(cursorPos, cursorPos), 0);
    }
  }

  useEffect(() => {
    if (data.prompt) {
      const enriched = data.paletteEnabled && (data.palette ?? []).length
        ? buildEnrichedPrompt(data.prompt, data.palette ?? [])
        : data.prompt;
      document.dispatchEvent(new CustomEvent('node:prompt-propagate', { detail: { sourceNodeId: id, prompt: enriched } }));
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

  function addColor() {
    if (palette.length >= MAX_PALETTE_COLORS) return;
    dispatchUpdate({ palette: [...palette, { name: '', hex: '#3b9eff' }] });
  }

  function removeColor(i: number) {
    const ref = `@color${i + 1}`;
    const newPalette = palette.filter((_, idx) => idx !== i);
    const newPrompt = (data.prompt ?? '').replaceAll(ref, '').replace(/  +/g, ' ').trim();
    dispatchUpdate({ palette: newPalette, prompt: newPrompt });
    propagatePrompt(newPrompt);
  }

  function updateColorHex(i: number, hex: string) {
    const newPalette = [...palette];
    newPalette[i] = { ...newPalette[i], hex };
    dispatchUpdate({ palette: newPalette });
  }

  function removeChipFromPrompt(ref: string) {
    const newPrompt = (data.prompt ?? '').replaceAll(ref, '').replace(/  +/g, ' ').trim();
    dispatchUpdate({ prompt: newPrompt });
    propagatePrompt(newPrompt);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!paletteEnabled || !palette.length) return;
    const ta = e.currentTarget;
    const pos = ta.selectionStart ?? 0;
    const selEnd = ta.selectionEnd ?? 0;
    const text = ta.value;
    const collapsed = pos === selEnd;

    if (e.key === 'Backspace' && collapsed) {
      const ending = tagEndingAt(text, pos, palette);
      if (ending) {
        e.preventDefault();
        const np = text.slice(0, ending.start) + text.slice(pos);
        dispatchUpdate({ prompt: np }); propagatePrompt(np);
        setTimeout(() => ta.setSelectionRange(ending.start, ending.start), 0);
        return;
      }
      const inside = tagAtPosition(text, pos, palette);
      if (inside) {
        e.preventDefault();
        const np = text.slice(0, inside.start) + text.slice(inside.end);
        dispatchUpdate({ prompt: np }); propagatePrompt(np);
        setTimeout(() => ta.setSelectionRange(inside.start, inside.start), 0);
        return;
      }
    }

    if (e.key === 'Delete' && collapsed) {
      const starting = tagStartingAt(text, pos, palette);
      if (starting) {
        e.preventDefault();
        const np = text.slice(0, pos) + text.slice(starting.end);
        dispatchUpdate({ prompt: np }); propagatePrompt(np);
        setTimeout(() => ta.setSelectionRange(pos, pos), 0);
        return;
      }
      const inside = tagAtPosition(text, pos, palette);
      if (inside) {
        e.preventDefault();
        const np = text.slice(0, inside.start) + text.slice(inside.end);
        dispatchUpdate({ prompt: np }); propagatePrompt(np);
        setTimeout(() => ta.setSelectionRange(inside.start, inside.start), 0);
        return;
      }
    }

    // Block typing inside a tag
    if (collapsed && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (tagAtPosition(text, pos, palette)) { e.preventDefault(); return; }
    }

    // Skip arrow keys over tags atomically
    if (collapsed && !e.shiftKey) {
      if (e.key === 'ArrowLeft') {
        const inside = tagAtPosition(text, pos, palette);
        if (inside) { e.preventDefault(); ta.setSelectionRange(inside.start, inside.start); return; }
        const ending = tagEndingAt(text, pos, palette);
        if (ending) { e.preventDefault(); ta.setSelectionRange(ending.start, ending.start); return; }
      }
      if (e.key === 'ArrowRight') {
        const inside = tagAtPosition(text, pos, palette);
        if (inside) { e.preventDefault(); ta.setSelectionRange(inside.end, inside.end); return; }
        const starting = tagStartingAt(text, pos, palette);
        if (starting) { e.preventDefault(); ta.setSelectionRange(starting.end, starting.end); return; }
      }
    }
  }

  function handleMouseUp() {
    if (!paletteEnabled || !palette.length) return;
    const ta = textareaRef.current;
    if (!ta) return;
    const pos = ta.selectionStart ?? 0;
    const selEnd = ta.selectionEnd ?? 0;
    if (pos !== selEnd) return;
    const inside = tagAtPosition(ta.value, pos, palette);
    // Synchronous — no setTimeout so there's no risk of firing after the user has moved on.
    if (inside) ta.setSelectionRange(inside.end, inside.end);
  }

  const selectStyle: React.CSSProperties = {
    background: 'var(--color-bg-surface)',
    border: 'none',
    color: 'var(--color-white)',
    borderRadius: 11,
  };

  return (
    <NodeWrapper title="Prompt" icon={<Type size={14} />} selected={selected} accentColor={PORT_COLORS.text}>

      {/* Prompt area — overlay shows chips while textarea captures input */}
      <div className="relative mb-2">
        {/* Chip overlay: absolute, pointer-events: none except × buttons */}
        {hasColorRefs && (
          <div
            aria-hidden="true"
            className="absolute inset-0 text-xs pointer-events-none"
            style={{
              lineHeight: LINE_H,
              color: 'var(--color-white)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflow: 'hidden',
            }}
          >
            <ChipOverlay text={data.prompt ?? ''} palette={palette} onRemoveRef={removeChipFromPrompt} />
          </div>
        )}
        {/* Textarea: text hidden when overlay is active so there's no double-rendering */}
        <textarea
          ref={textareaRef}
          className="w-full text-xs outline-none nodrag"
          rows={2}
          placeholder={hasColorRefs ? '' : 'Write your prompt here…'}
          value={data.prompt ?? ''}
          onChange={handlePromptChange}
          onKeyDown={handleKeyDown}
          onMouseUp={handleMouseUp}
          style={{
            background: 'transparent',
            border: 'none',
            color: hasColorRefs ? 'transparent' : 'var(--color-white)',
            caretColor: 'var(--color-white)',
            resize: 'none',
            overflow: 'hidden',
            minHeight: 40,
            lineHeight: LINE_H,
          }}
        />
      </div>

      {/* Model + length selectors */}
      <div className="grid grid-cols-2 gap-1.5 mb-2">
        <select value={geminiModel} onChange={(e) => setGeminiModel(e.target.value)} className="w-full px-2 py-1.5 text-xs outline-none nodrag" style={selectStyle}>
          {GEMINI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <select value={length} onChange={(e) => setLength(e.target.value)} className="w-full px-2 py-1.5 text-xs outline-none nodrag" style={selectStyle}>
          {LENGTH_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>

      {/* [Add Palette]  [Enhance →] */}
      <div className="flex gap-1.5">
        <button
          onClick={() => dispatchUpdate({ paletteEnabled: !paletteEnabled })}
          className="flex items-center gap-1 px-2.5 py-2 text-xs font-medium transition-colors nodrag shrink-0"
          style={{
            background: paletteEnabled ? 'var(--color-accent)' : 'var(--color-bg-surface)',
            color: paletteEnabled ? '#fff' : 'var(--color-white-muted)',
            borderRadius: 11,
          }}
        >
          <Droplet size={11} />
          {paletteEnabled ? 'Palette' : 'Add Palette'}
        </button>
        <button
          onClick={handleEnhance}
          disabled={enhancing || !data.prompt?.trim()}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-opacity disabled:opacity-40 nodrag"
          style={{ background: '#fff', color: '#000', borderRadius: 11 }}
        >
          <Sunrise size={11} className={enhancing ? 'animate-pulse' : ''} />
          {enhancing ? 'Enhancing…' : 'Enhance'}
        </button>
      </div>

      {/* Color palette section */}
      {paletteEnabled && (
        <div className="mt-2.5">
          <p className="text-[9px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--color-white-muted)' }}>
            Color Palette
          </p>
          {palette.map((color, i) => (
            <div key={i} className="flex items-center gap-2 mb-1.5">
              <label
                className="nodrag shrink-0 cursor-pointer"
                style={{ display: 'block', width: 20, height: 20, borderRadius: 5, background: color.hex, overflow: 'hidden', position: 'relative' }}
              >
                <input
                  type="color"
                  value={color.hex}
                  onChange={(e) => updateColorHex(i, e.target.value)}
                  className="nodrag"
                  style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', padding: 0, border: 'none' }}
                />
              </label>
              <span className="text-xs flex-1" style={{ color: 'var(--color-white-muted)', fontFamily: 'monospace', fontSize: 11 }}>
                @color{i + 1}
              </span>
              <button onClick={() => removeColor(i)} className="nodrag shrink-0" style={{ color: 'rgba(255,255,255,0.35)' }}>
                <X size={11} />
              </button>
            </div>
          ))}
          {palette.length < MAX_PALETTE_COLORS && (
            <button onClick={addColor} className="flex items-center gap-1 mt-0.5 text-xs nodrag" style={{ color: 'rgba(255,255,255,0.35)' }}>
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
