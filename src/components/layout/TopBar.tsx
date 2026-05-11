'use client';

import Link from 'next/link';
import { ChevronRight, Cloud, CloudUpload, Undo2, Redo2, Share2 } from 'lucide-react';
import { useState } from 'react';
import { useFlowStore } from '@/lib/stores/flowStore';
import { createClient } from '@/lib/supabase/client';

interface TopBarProps {
  flowId: string;
}

export function TopBar({ flowId }: TopBarProps) {
  const { currentFlow, isDirty, isSaving, nodes, edges, setDirty, setSaving, setLastSaved } = useFlowStore();
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');

  const supabase = createClient();

  function startEditTitle() {
    setTitleValue(currentFlow?.title ?? '');
    setEditingTitle(true);
  }

  async function saveTitle() {
    if (!currentFlow || !titleValue.trim()) {
      setEditingTitle(false);
      return;
    }
    await supabase
      .from('flows')
      .update({ title: titleValue.trim(), updated_at: new Date().toISOString() })
      .eq('id', flowId);
    useFlowStore.setState({ currentFlow: { ...currentFlow, title: titleValue.trim() } });
    setEditingTitle(false);
  }

  async function handleSave() {
    if (!currentFlow || isSaving) return;
    setSaving(true);
    try {
      await supabase
        .from('flows')
        .update({
          flow_data: {
            nodes: nodes.map(n => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
            edges,
            viewport: { x: 0, y: 0, zoom: 1 },
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', flowId);
      setDirty(false);
      setLastSaved(new Date());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="absolute top-4 left-4 right-4 z-10 flex items-center justify-between px-4 py-2.5 rounded-xl pointer-events-none"
      style={{
        background: 'rgba(28, 28, 29, 0.85)',
        backdropFilter: 'blur(12px)',
        border: 'var(--border-default)',
        boxShadow: 'var(--shadow-node)',
      }}
    >
      {/* Left: breadcrumb */}
      <div className="flex items-center gap-2 pointer-events-auto">
        <Link
          href="/dashboard/canvas-flow"
          className="flex items-center gap-1 text-sm transition-opacity hover:opacity-80"
          style={{ color: 'var(--color-white-muted)' }}
        >
          <span className="text-xs">⊞</span>
          Flows
        </Link>
        <ChevronRight size={12} style={{ color: 'var(--color-white-muted)' }} />
        {editingTitle ? (
          <input
            autoFocus
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveTitle();
              if (e.key === 'Escape') setEditingTitle(false);
            }}
            className="text-sm font-medium bg-transparent outline-none border-b"
            style={{
              color: 'var(--color-white)',
              borderColor: 'var(--color-accent)',
              minWidth: '120px',
            }}
          />
        ) : (
          <button
            onClick={startEditTitle}
            className="text-sm font-medium transition-opacity hover:opacity-80"
            style={{ color: 'var(--color-white)' }}
          >
            {currentFlow?.title ?? 'Untitled Flow'}
          </button>
        )}
        {isDirty && (
          <span className="text-xs" style={{ color: 'var(--color-white-muted)' }}>•</span>
        )}
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-2 pointer-events-auto">
        <button
          className="p-1.5 rounded-lg transition-colors hover:bg-white/10 disabled:opacity-40"
          title="Undo (Ctrl+Z)"
          disabled
        >
          <Undo2 size={14} style={{ color: 'var(--color-white-muted)' }} />
        </button>
        <button
          className="p-1.5 rounded-lg transition-colors hover:bg-white/10 disabled:opacity-40"
          title="Redo"
          disabled
        >
          <Redo2 size={14} style={{ color: 'var(--color-white-muted)' }} />
        </button>

        <div className="w-px h-4" style={{ background: 'var(--color-white-subtle)' }} />

        <button
          onClick={handleSave}
          disabled={!isDirty || isSaving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-40"
          style={{
            background: isDirty ? '#fff' : 'transparent',
            color: isDirty ? '#000' : 'var(--color-white-muted)',
            border: isDirty ? 'none' : 'var(--border-default)',
          }}
        >
          {isSaving ? <Cloud size={12} className="animate-pulse" /> : <CloudUpload size={12} />}
          {isSaving ? 'Saving...' : 'Save'}
        </button>

        <button
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium opacity-40"
          style={{ border: 'var(--border-default)', color: 'var(--color-white-muted)' }}
          title="Share (coming soon)"
        >
          <Share2 size={12} />
          Share
        </button>
      </div>
    </div>
  );
}
