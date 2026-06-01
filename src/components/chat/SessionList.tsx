'use client';

import { useRef, useState, useEffect } from 'react';
import { Plus, MessageSquare, Trash2, Pencil, Check } from 'lucide-react';
import { useChatStore } from '@/lib/stores/chatStore';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';
import { formatDistanceToNow } from '@/lib/utils/date';
import { resolveMediaUrl } from '@/lib/utils/mediaUtils';
import type { ChatSession } from '@/types';

interface SessionListProps {
  onNewSession: () => void;
}

export function SessionList({ onNewSession }: SessionListProps) {
  const { sessions, activeSessionId, setActiveSessionId, removeSession, updateSession } = useChatStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue]   = useState('');
  const editRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();

  async function handleDelete(session: ChatSession, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Delete "${session.title}"?`)) return;
    await supabase.from('chat_sessions').delete().eq('id', session.id);
    removeSession(session.id);
    if (activeSessionId === session.id) {
      const next = sessions.find((s) => s.id !== session.id);
      setActiveSessionId(next?.id ?? null);
    }
  }

  function startEdit(session: ChatSession, e: React.MouseEvent) {
    e.stopPropagation();
    setEditingId(session.id);
    setEditValue(session.title);
    setTimeout(() => { editRef.current?.focus(); editRef.current?.select(); }, 0);
  }

  async function commitEdit(sessionId: string) {
    const trimmed = editValue.trim();
    setEditingId(null);
    if (!trimmed) return;
    const current = sessions.find(s => s.id === sessionId);
    if (current && trimmed !== current.title) {
      updateSession(sessionId, { title: trimmed });
      await supabase.from('chat_sessions').update({ title: trimmed }).eq('id', sessionId);
    }
  }

  return (
    <div
      className="flex flex-col h-full"
      style={{ width: 240, borderRight: 'var(--border-default)', background: 'var(--color-bg-darkest)', flexShrink: 0 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: 'var(--border-default)' }}>
        <span className="text-sm font-semibold" style={{ color: 'var(--color-white)' }}>Sessions</span>
        <button onClick={onNewSession} className="p-1 rounded-lg transition-colors hover:bg-white/10">
          <Plus size={16} style={{ color: 'var(--color-white-muted)' }} />
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
            <MessageSquare size={32} className="mb-3 opacity-20" style={{ color: 'var(--color-white)' }} />
            <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>No sessions yet</p>
          </div>
        ) : (
          sessions.map((session) => {
            const isActive  = activeSessionId === session.id;
            const isEditing = editingId === session.id;

            return (
              <div
                key={session.id}
                className={cn(
                  'group flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors mb-0.5',
                  isActive ? 'bg-white/10' : 'hover:bg-white/5'
                )}
                onClick={() => !isEditing && setActiveSessionId(session.id)}
              >
                {/* Thumbnail */}
                <div
                  className="shrink-0 rounded-md overflow-hidden flex items-center justify-center"
                  style={{ width: 36, height: 36, background: 'var(--color-bg-surface)' }}
                >
                  {session.thumbnail_url ? (
                    <SessionThumbnail url={session.thumbnail_url} />
                  ) : (
                    <MessageSquare size={14} style={{ color: 'var(--color-white-muted)', opacity: 0.4 }} />
                  )}
                </div>

                {/* Title + date */}
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <input
                      ref={editRef}
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitEdit(session.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      onBlur={() => commitEdit(session.id)}
                      onClick={e => e.stopPropagation()}
                      className="w-full text-sm outline-none rounded px-1"
                      style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-accent)', color: 'var(--color-white)' }}
                    />
                  ) : (
                    <p
                      className="text-sm truncate"
                      style={{ color: isActive ? 'var(--color-white)' : 'var(--color-white-muted)' }}
                    >
                      {session.title}
                    </p>
                  )}
                  <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-white-muted)', opacity: 0.6 }}>
                    {formatDistanceToNow(session.updated_at)}
                  </p>
                </div>

                {/* Actions (shown on hover) */}
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  {isEditing ? (
                    <button
                      onClick={e => { e.stopPropagation(); commitEdit(session.id); }}
                      className="p-0.5 rounded"
                    >
                      <Check size={12} style={{ color: 'var(--color-accent)' }} />
                    </button>
                  ) : (
                    <button onClick={e => startEdit(session, e)} className="p-0.5 rounded hover:bg-white/10">
                      <Pencil size={11} style={{ color: 'var(--color-white-muted)' }} />
                    </button>
                  )}
                  <button onClick={e => handleDelete(session, e)} className="p-0.5 rounded hover:bg-white/10">
                    <Trash2 size={11} style={{ color: 'var(--color-white-muted)' }} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function SessionThumbnail({ url }: { url: string }) {
  const [resolved, setResolved] = useState(url);

  useEffect(() => {
    resolveMediaUrl(url).then(setResolved);
  }, [url]);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={resolved} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
  );
}
