'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Type, Sparkles } from 'lucide-react';
import { useCallback, useState } from 'react';
import { NodeWrapper } from './NodeWrapper';
import type { PromptNodeData } from '@/types';

export function PromptNode({ data, selected, id }: NodeProps & { data: PromptNodeData }) {
  const [enhancing, setEnhancing] = useState(false);

  const handlePromptChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const event = new CustomEvent('node:update', {
        detail: { nodeId: id, data: { prompt: e.target.value } },
        bubbles: true,
      });
      e.target.dispatchEvent(event);
    },
    [id]
  );

  async function handleEnhance() {
    if (!data.prompt?.trim() || enhancing) return;
    setEnhancing(true);
    try {
      const res = await fetch('/api/google/enhance-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: data.prompt, mediaType: 'image', modelName: 'flux-2-pro' }),
      });
      const { enhancedPrompt } = await res.json();
      if (enhancedPrompt) {
        const event = new CustomEvent('node:update', {
          detail: { nodeId: id, data: { prompt: enhancedPrompt } },
          bubbles: true,
        });
        document.dispatchEvent(event);
      }
    } finally {
      setEnhancing(false);
    }
  }

  return (
    <NodeWrapper title="Prompt" icon={<Type size={14} />} selected={selected}>
      <div className="relative">
        <textarea
          className="w-full text-xs resize-none rounded-lg p-2.5 outline-none transition-all nodrag"
          rows={4}
          placeholder="Describe what you want to generate..."
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
          className="absolute bottom-2 right-2 p-1 rounded transition-opacity hover:opacity-80 disabled:opacity-40 nodrag"
          title="Enhance prompt with AI"
        >
          <Sparkles
            size={12}
            style={{ color: enhancing ? 'var(--color-processing)' : 'var(--color-accent)' }}
            className={enhancing ? 'animate-pulse' : ''}
          />
        </button>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="prompt"
        style={{
          background: 'var(--color-accent)',
          border: '2px solid var(--color-bg-elevated)',
          width: 10,
          height: 10,
        }}
      />
    </NodeWrapper>
  );
}
