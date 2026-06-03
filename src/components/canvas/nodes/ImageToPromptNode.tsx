'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Wand2, RefreshCw, Copy, Check, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import type { ImageToPromptNodeData } from '@/types';

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

const LENGTH_OPTIONS = [
  { id: 'auto',   label: 'Auto' },
  { id: 'short',  label: 'Short' },
  { id: 'medium', label: 'Medium' },
  { id: 'long',   label: 'Long' },
];

export function ImageToPromptNode({ data, selected, id }: NodeProps & { data: ImageToPromptNodeData }) {
  const [copied, setCopied] = useState(false);
  const [length, setLength] = useState('auto');
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isFocused = useRef(false);

  const [localPrompt, setLocalPrompt] = useState(data.generatedPrompt ?? '');

  // Sync from external data (history navigation, new generation) when not focused
  useEffect(() => {
    if (!isFocused.current) setLocalPrompt(data.generatedPrompt ?? '');
  }, [data.generatedPrompt]);

  const promptHistory: string[] = data.promptHistory ?? [];
  const [historyIdx, setHistoryIdx] = useState(() => Math.max(0, promptHistory.length - 1));
  const isViewingHistory = promptHistory.length > 1 && historyIdx < promptHistory.length - 1;

  // Stay at latest when a new result is appended
  const prevLen = useRef(promptHistory.length);
  useEffect(() => {
    if (promptHistory.length > prevLen.current) setHistoryIdx(promptHistory.length - 1);
    prevLen.current = promptHistory.length;
  }, [promptHistory.length]);

  useLayoutEffect(() => {
    if (textareaRef.current) autoResize(textareaRef.current);
  }, [localPrompt, historyIdx]);

  function updateData(updates: Partial<ImageToPromptNodeData>) {
    document.dispatchEvent(new CustomEvent('node:update', { detail: { nodeId: id, data: updates } }));
  }

  function propagate(prompt: string) {
    document.dispatchEvent(new CustomEvent('node:prompt-propagate', {
      detail: { sourceNodeId: id, prompt },
    }));
  }

  async function handleAnalyze() {
    if (!data.inputImageUrl || data.status === 'processing') return;
    updateData({ status: 'processing', generatedPrompt: undefined });

    try {
      const res = await fetch('/api/google/image-to-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: data.inputImageUrl, length }),
      });
      const result = await res.json();
      if (result.prompt) {
        const history = data.promptHistory ?? [];
        const newHistory = [...history, result.prompt];
        updateData({ status: 'completed', generatedPrompt: result.prompt, promptHistory: newHistory });
        propagate(result.prompt);
      } else {
        updateData({ status: 'error' });
      }
    } catch {
      updateData({ status: 'error' });
    }
  }

  function navigateHistory(idx: number) {
    setHistoryIdx(idx);
    const entry = promptHistory[idx] ?? '';
    updateData({ generatedPrompt: entry });
    propagate(entry);
  }

  function handleCopy() {
    if (!localPrompt) return;
    navigator.clipboard.writeText(localPrompt);
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2000);
  }

  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); }, []);

  const isProcessing = data.status === 'processing';
  const hasPrompt = !!data.generatedPrompt;
  const hasImage = !!data.inputImageUrl;

  return (
    <NodeWrapper
      title="Image to Prompt"
      icon={<Wand2 size={14} />}
      status={data.status}
      selected={selected}
      minWidth={280}
      accentColor={PORT_COLORS.text}
    >
      <TypedHandle type="target" position={Position.Left} id="image" portType="image" />
      <TypedHandle type="source" position={Position.Right} id="prompt" portType="text" />

      {/* Version history navigation */}
      {promptHistory.length > 1 && (
        <div className="flex items-center justify-between mb-1.5">
          <button
            onClick={() => navigateHistory(Math.max(0, historyIdx - 1))}
            disabled={historyIdx === 0}
            className="flex items-center p-0.5 rounded transition-opacity disabled:opacity-30 nodrag"
            style={{ color: 'var(--color-white-muted)' }}
          >
            <ChevronLeft size={13} />
          </button>
          <span className="text-xs" style={{ color: isViewingHistory ? 'var(--color-accent)' : 'var(--color-white-muted)', fontSize: 10 }}>
            {`VERSION ${historyIdx + 1}`}
          </span>
          <button
            onClick={() => navigateHistory(Math.min(promptHistory.length - 1, historyIdx + 1))}
            disabled={historyIdx === promptHistory.length - 1}
            className="flex items-center p-0.5 rounded transition-opacity disabled:opacity-30 nodrag"
            style={{ color: 'var(--color-white-muted)' }}
          >
            <ChevronRight size={13} />
          </button>
        </div>
      )}

      {/* Image preview */}
      {hasImage ? (
        <div
          className="-mx-3 mb-3 overflow-hidden"
          style={{ height: 90, position: 'relative',
            backgroundImage: 'conic-gradient(#3a3a3a 90deg, #2a2a2a 90deg 180deg, #3a3a3a 180deg 270deg, #2a2a2a 270deg)',
            backgroundSize: '14px 14px',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={data.inputImageUrl}
            alt="Input"
            className="w-full h-full object-contain block nodrag"
          />
        </div>
      ) : (
        <div
          className="flex items-center justify-center mb-3 rounded-lg text-xs"
          style={{ height: 72, background: 'var(--color-bg-surface)', border: '1px dashed rgba(255,255,255,0.15)', color: 'var(--color-white-muted)' }}
        >
          Connect an image to analyze
        </div>
      )}

      {/* Length selector + Analyze button */}
      <div className="flex gap-1.5 mb-2">
        <select
          value={length}
          onChange={(e) => setLength(e.target.value)}
          disabled={isProcessing}
          className="px-2 py-2 text-xs outline-none nodrag shrink-0"
          style={{ background: 'var(--color-bg-surface)', border: 'none', color: 'var(--color-white)', borderRadius: 11 }}
        >
          {LENGTH_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <button
          onClick={handleAnalyze}
          disabled={!hasImage || isProcessing}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-opacity disabled:opacity-40 nodrag"
          style={{ background: '#fff', color: '#000', borderRadius: 11 }}
        >
          {isProcessing ? (
            <><RefreshCw size={11} className="animate-spin" /> Analyzing…</>
          ) : (
            <><Wand2 size={11} /> Analyze Image</>
          )}
        </button>
      </div>

      {/* Error state */}
      {data.status === 'error' && !hasPrompt && (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs mb-2"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#fca5a5' }}
        >
          <AlertTriangle size={12} style={{ flexShrink: 0 }} />
          Analysis failed. Try again.
        </div>
      )}

      {/* Generated prompt — editable */}
      {hasPrompt && (
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={localPrompt}
            rows={1}
            className="w-full text-xs outline-none nodrag resize-none"
            style={{
              background: 'var(--color-bg-surface)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8,
              color: 'var(--color-white)',
              padding: '8px 32px 8px 10px',
              lineHeight: 1.6,
              overflow: 'hidden',
            }}
            onFocus={() => { isFocused.current = true; }}
            onBlur={() => { isFocused.current = false; }}
            onChange={(e) => {
              const v = e.target.value;
              setLocalPrompt(v);
              autoResize(e.target);
              updateData({ generatedPrompt: v });
              propagate(v);
            }}
          />
          <button
            onClick={handleCopy}
            className="absolute top-1.5 right-1.5 p-1 rounded nodrag transition-opacity hover:opacity-80"
            style={{ color: 'var(--color-white-muted)' }}
            title="Copy prompt"
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
          </button>
        </div>
      )}
    </NodeWrapper>
  );
}
