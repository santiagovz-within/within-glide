'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Type, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle } from './TypedHandle';
import type { PromptNodeData } from '@/types';

export function PromptNode({ data, selected, id }: NodeProps & { data: PromptNodeData }) {
  const [enhancing, setEnhancing] = useState(false);

  function handlePromptChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const newPrompt = e.target.value;
    // Update this node's data
    document.dispatchEvent(new CustomEvent('node:update', {
      detail: { nodeId: id, data: { prompt: newPrompt } },
    }));
    // Propagate to all downstream nodes so connected gen nodes stay in sync
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
        body: JSON.stringify({ prompt: data.prompt, mediaType: 'image', modelName: '' }),
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

  return (
    <NodeWrapper title="Prompt" icon={<Type size={14} />} selected={selected}>
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
      <button
        onClick={handleEnhance}
        disabled={enhancing || !data.prompt?.trim()}
        className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-opacity disabled:opacity-40 nodrag"
        style={{
          background: 'var(--color-bg-surface)',
          border: 'var(--border-default)',
          color: enhancing ? 'var(--color-processing)' : 'var(--color-accent)',
        }}
      >
        <Sparkles size={11} className={enhancing ? 'animate-pulse' : ''} />
        {enhancing ? 'Enhancing…' : 'Enhance'}
      </button>

      <TypedHandle type="source" position={Position.Right} id="prompt" portType="text" />
    </NodeWrapper>
  );
}
