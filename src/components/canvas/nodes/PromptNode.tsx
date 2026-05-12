'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Type, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import type { PromptNodeData } from '@/types';

const GEMINI_MODELS = [
  { id: 'gemini-2.5-flash-preview-05-20', label: 'Gemini 2.5 Flash Preview' },
  { id: 'gemini-2.0-flash-lite',          label: 'Gemini 2.0 Flash Lite' },
];

const LENGTH_OPTIONS = [
  { id: 'auto',   label: 'Auto' },
  { id: 'short',  label: 'Short' },
  { id: 'medium', label: 'Medium' },
  { id: 'long',   label: 'Long' },
];

export function PromptNode({ data, selected, id }: NodeProps & { data: PromptNodeData }) {
  const [enhancing, setEnhancing] = useState(false);
  const [geminiModel, setGeminiModel] = useState('gemini-2.5-flash-preview-05-20');
  const [length, setLength] = useState('auto');

  function handlePromptChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
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
    border: 'var(--border-default)',
    color: 'var(--color-white)',
  };

  return (
    <NodeWrapper title="Prompt" icon={<Type size={14} />} selected={selected} accentColor={PORT_COLORS.text}>
      <textarea
        className="w-full text-xs resize-y rounded-lg p-2.5 outline-none transition-all nodrag mb-2"
        rows={4}
        placeholder="Describe what you want to generate…"
        value={data.prompt ?? ''}
        onChange={handlePromptChange}
        style={{
          background: 'var(--color-bg-surface)',
          border: 'var(--border-default)',
          color: 'var(--color-white)',
        }}
      />

      {/* Model + length selectors */}
      <div className="grid grid-cols-2 gap-1.5 mb-2">
        <select
          value={geminiModel}
          onChange={(e) => setGeminiModel(e.target.value)}
          className="w-full px-2 py-1.5 rounded-lg text-xs outline-none nodrag"
          style={selectStyle}
        >
          {GEMINI_MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        <select
          value={length}
          onChange={(e) => setLength(e.target.value)}
          className="w-full px-2 py-1.5 rounded-lg text-xs outline-none nodrag"
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
        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-opacity disabled:opacity-40 nodrag"
        style={{ background: '#fff', color: '#000' }}
      >
        <Sparkles size={11} className={enhancing ? 'animate-pulse' : ''} />
        {enhancing ? 'Enhancing…' : 'Enhance Prompt'}
      </button>

      <TypedHandle type="source" position={Position.Right} id="prompt" portType="text" />
    </NodeWrapper>
  );
}
