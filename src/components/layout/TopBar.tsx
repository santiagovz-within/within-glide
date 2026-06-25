'use client';

import Link from 'next/link';
import { ChevronRight, Cloud, UploadCloud, RotateCcw, RotateCw, Share2, BookOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useFlowStore } from '@/lib/stores/flowStore';
import { createClient } from '@/lib/supabase/client';
import type { Node } from '@xyflow/react';
import type { NodeData, ImageGenNodeData, UpscaleNodeData, ImageInputNodeData } from '@/types';
import { compressToThumbnailDataUrl } from '@/lib/utils/imageProcessing';

async function uploadThumbnailToGCS(dataUrl: string, flowId: string): Promise<string | null> {
  try {
    const res = await fetch('/api/thumbnails/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl, flowId }),
    });
    if (!res.ok) return null;
    const { ref } = await res.json();
    return ref ?? null;
  } catch {
    return null;
  }
}

function extractThumbnail(nodes: Node<NodeData>[]): string | null {
  for (const node of nodes) {
    if (node.type === 'imageGenNode') {
      const url = (node.data as ImageGenNodeData).generatedImages?.[0];
      if (url) return url;
    }
    if (node.type === 'upscaleNode') {
      const url = (node.data as UpscaleNodeData).outputImageUrl;
      if (url) return url;
    }
    if (node.type === 'imageInputNode') {
      const url = (node.data as ImageInputNodeData).imageUrl;
      if (url) return url;
    }
  }
  return null;
}

interface TopBarProps {
  flowId: string;
}

export function TopBar({ flowId }: TopBarProps) {
  const { currentFlow, isDirty, isSaving, nodes, edges, setDirty, setSaving, setLastSaved } = useFlowStore();
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [savingBase, setSavingBase] = useState(false);
  const [isBaseFlow, setIsBaseFlow] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    async function checkAdmin() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single();
      setIsAdmin(profile?.is_admin ?? false);
    }
    checkAdmin();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setIsBaseFlow(currentFlow?.is_template ?? false);
  }, [currentFlow]);

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
      const rawThumb = extractThumbnail(nodes);
      let thumbnail: string | null = null;
      if (rawThumb) {
        const dataUrl = await compressToThumbnailDataUrl(rawThumb);
        if (dataUrl) thumbnail = await uploadThumbnailToGCS(dataUrl, flowId);
      }
      await supabase
        .from('flows')
        .update({
          flow_data: {
            nodes: nodes.map(n => ({ id: n.id, type: n.type, position: n.position, data: n.data, parentId: n.parentId, style: n.style })),
            edges,
            viewport: { x: 0, y: 0, zoom: 1 },
          },
          ...(thumbnail ? { thumbnail_url: thumbnail } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', flowId);
      setDirty(false);
      setLastSaved(new Date());
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveAsBaseFlow() {
    if (!currentFlow || savingBase) return;
    const confirmMsg = isBaseFlow
      ? 'Remove this flow from Base Flows? Users will no longer see it as a template.'
      : 'Save this flow as a Base Flow? All users will be able to use it as a starting template.';
    if (!confirm(confirmMsg)) return;
    setSavingBase(true);
    try {
      const rawThumb = extractThumbnail(nodes);
      let thumbnail: string | null = null;
      if (rawThumb) {
        const dataUrl = await compressToThumbnailDataUrl(rawThumb);
        if (dataUrl) thumbnail = await uploadThumbnailToGCS(dataUrl, flowId);
      }
      await supabase.from('flows').update({
        is_template: !isBaseFlow,
        flow_data: {
          nodes: nodes.map(n => ({ id: n.id, type: n.type, position: n.position, data: n.data, parentId: n.parentId, style: n.style })),
          edges,
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        ...(thumbnail ? { thumbnail_url: thumbnail } : {}),
        updated_at: new Date().toISOString(),
      }).eq('id', flowId);
      setIsBaseFlow(!isBaseFlow);
      setDirty(false);
      setLastSaved(new Date());
    } finally {
      setSavingBase(false);
    }
  }

  return (
    <div
      className="absolute top-4 left-4 right-4 z-10 flex items-center justify-between px-4 py-2.5 rounded-xl pointer-events-none"
      style={{
        background: 'var(--topbar-bg)',
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
            style={{ color: 'var(--color-white)', borderColor: 'var(--color-accent)', minWidth: '120px' }}
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
        {isBaseFlow && (
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
            style={{ background: 'rgba(59,158,255,0.15)', color: 'var(--color-accent)' }}
          >
            <BookOpen size={9} />
            Base Flow
          </span>
        )}
        {isDirty && (
          <span className="text-xs" style={{ color: 'var(--color-white-muted)' }}>•</span>
        )}
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-2 pointer-events-auto">
        <button className="p-1.5 rounded-lg transition-colors hover:bg-white/10 disabled:opacity-40" title="Undo" disabled>
          <RotateCcw size={14} style={{ color: 'var(--color-white-muted)' }} />
        </button>
        <button className="p-1.5 rounded-lg transition-colors hover:bg-white/10 disabled:opacity-40" title="Redo" disabled>
          <RotateCw size={14} style={{ color: 'var(--color-white-muted)' }} />
        </button>

        <div className="w-px h-4" style={{ background: 'var(--color-white-subtle)' }} />

        {/* Admin: Save as Base Flow toggle */}
        {isAdmin && (
          <button
            onClick={handleSaveAsBaseFlow}
            disabled={savingBase}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-40"
            style={{
              background: isBaseFlow ? 'rgba(59,158,255,0.2)' : 'transparent',
              color: isBaseFlow ? 'var(--color-accent)' : 'var(--color-white-muted)',
              border: 'var(--border-default)',
            }}
            title={isBaseFlow ? 'Remove from Base Flows' : 'Save as Base Flow (visible to all users)'}
          >
            <BookOpen size={12} />
            {isBaseFlow ? 'Base Flow ✓' : 'Make Base Flow'}
          </button>
        )}

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
          {isSaving ? <Cloud size={12} className="animate-pulse" /> : <UploadCloud size={12} />}
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
