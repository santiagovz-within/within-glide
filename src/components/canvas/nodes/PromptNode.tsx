'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Type, Star } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import type { PromptNodeData } from '@/types';

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

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

export function PromptNode({ data, selected, id }: NodeProps & { data: PromptNodeData }) {
  const [enhancing, setEnhancing] = useState(false);
  const [geminiModel, setGeminiModel] = useState('gemini-3-flash-preview');
  const [length, setLength] = useState('auto');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) autoResize(textareaRef.current);
  }, [data.prompt]);

  function handlePromptChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    autoResize(e.target);
    const newPrompt = e.target.value;
    document.dispatchEvent(new CustomEvent('node:update', {
      detail: { nodeId: id, data: { prompt: newPrompt } },
    }));
    document.dispatchEvent(new CustomEvent('node:prompt-propagate', {
      detail: { sourceNodeId: id, prompt: newPrompt },
    }));
  }

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
        document.dispatchEvent(new CustomEvent('node:update', {
          detail: { nodeId: id, data: { prompt: enhancedPrompt } },
        }));
        document.dispatchEvent(new CustomEvent('node:prompt-propagate', {
          detail: { sourceNodeId: id, prompt: enhancedPrompt },
        }));
      }
    } finally {
      setEnhancing(false);
    }
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

      <button
        onClick={handleEnhance}
        disabled={enhancing || !data.prompt?.trim()}
        className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-opacity disabled:opacity-40 nodrag"
        style={{ background: '#fff', color: '#000', borderRadius: 11 }}
      >
        <Star size={11} className={enhancing ? 'animate-pulse' : ''} />
        {enhancing ? 'Enhancing…' : 'Enhance Prompt'}
      </button>

      <TypedHandle type="source" position={Position.Right} id="prompt" portType="text" />
    </NodeWrapper>
  );
}
