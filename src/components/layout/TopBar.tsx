'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, Cloud, UploadCloud, RotateCcw, RotateCw, Share2, Check, BookOpen } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useFlowStore } from '@/lib/stores/flowStore';
import { createClient } from '@/lib/supabase/client';

interface TopBarProps {
  flowId: string;
  isOwner?: boolean;
  isShared?: boolean;
  onToggleShare?: () => void;
  onSave: () => Promise<boolean>;
}

export function TopBar({ flowId, isOwner = true, isShared = false, onToggleShare, onSave }: TopBarProps) {
  const router = useRouter();
  const { currentFlow, isDirty, isSaving } = useFlowStore();
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [savingBase, setSavingBase] = useState(false);
  const [copied, setCopied] = useState(false);
  const isBaseFlow = currentFlow?.is_template ?? false;

  const supabase = useMemo(() => createClient(), []);

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
  }, [supabase]);

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
    await onSave();
  }

  async function handleSaveAsBaseFlow() {
    if (!currentFlow || savingBase) return;
    const confirmMsg = isBaseFlow
      ? 'Remove this flow from Base Flows? Users will no longer see it as a template.'
      : 'Save this flow as a Base Flow? All users will be able to use it as a starting template.';
    if (!confirm(confirmMsg)) return;
    setSavingBase(true);
    try {
      if (isDirty && !(await onSave())) return;
      await supabase.from('flows').update({
        is_template: !isBaseFlow,
        updated_at: new Date().toISOString(),
      }).eq('id', flowId);
      useFlowStore.setState((state) => ({
        currentFlow: state.currentFlow
          ? { ...state.currentFlow, is_template: !isBaseFlow }
          : null,
      }));
    } finally {
      setSavingBase(false);
    }
  }

  async function handleFlowsNavigation(event: React.MouseEvent<HTMLAnchorElement>) {
    if (!isDirty && !isSaving) return;
    event.preventDefault();
    if (useFlowStore.getState().isSaving) {
      await new Promise<void>((resolve) => {
        let unsubscribe = () => {};
        const timeoutId = window.setTimeout(() => {
          unsubscribe();
          resolve();
        }, 30_000);
        unsubscribe = useFlowStore.subscribe((state) => {
          if (state.isSaving) return;
          window.clearTimeout(timeoutId);
          unsubscribe();
          resolve();
        });
      });
    }

    if (useFlowStore.getState().isDirty && !(await onSave())) return;
    if (!useFlowStore.getState().isDirty) router.push('/dashboard/canvas-flow');
  }

  function handleShare() {
    if (!isShared && onToggleShare) onToggleShare();
    navigator.clipboard.writeText(window.location.href).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
          onClick={handleFlowsNavigation}
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
        {isOwner && (
          <>
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
                disabled={savingBase || isSaving}
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
          </>
        )}

        <button
          onClick={handleShare}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
          style={{
            background: (isShared || copied) ? 'rgba(59,158,255,0.15)' : 'transparent',
            color: (isShared || copied) ? 'var(--color-accent)' : 'var(--color-white-muted)',
            border: 'var(--border-default)',
          }}
          title={isShared ? 'Link copied to clipboard' : 'Share this flow'}
        >
          {copied ? <Check size={12} /> : <Share2 size={12} />}
          {copied ? 'Copied!' : isShared ? 'Shared' : 'Share'}
        </button>
      </div>
    </div>
  );
}
