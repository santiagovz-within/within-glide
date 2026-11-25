'use client';

import { useRef, useState, useEffect } from 'react';
import { Plus, MessageSquare, Music, Trash2, Pencil, Check } from 'lucide-react';
import { useChatStore } from '@/lib/stores/chatStore';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';
import { formatDistanceToNow } from '@/lib/utils/date';
import { resolveMediaUrl } from '@/lib/utils/mediaUtils';
import { RecordingSessionThumbnail } from '@/components/audio/RecordingSessionThumbnail';
import type { ChatSession } from '@/types';

interface SessionListProps {
  onNewSession: () => void;
}

export function SessionList({ onNewSession }: SessionListProps) {
  const { sessions, activeSessionId, setActiveSessionId, removeSession, updateSession } = useChatStore();
  return <SessionListPanel {...{ onNewSession, sessions, activeSessionId, setActiveSessionId, removeSession, updateSession }} />;
}

interface SessionListPanelProps extends SessionListProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  setActiveSessionId: (id: string | null) => void;
  removeSession: (id: string) => void;
  updateSession: (id: string, updates: Partial<ChatSession>) => void;
  audio?: boolean;
  creating?: boolean;
  loading?: boolean;
  isSessionBusy?: (id: string) => boolean;
}

export function SessionListPanel({ onNewSession, sessions, activeSessionId, setActiveSessionId,
  removeSession, updateSession, audio = false, creating = false, loading = false, isSessionBusy }: SessionListPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue]   = useState('');
  const [error, setError] = useState('');
  const editRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();
  const SessionIcon = audio ? Music : MessageSquare;

  async function handleDelete(session: ChatSession, e: React.MouseEvent) {
    e.stopPropagation();
    if (isSessionBusy?.(session.id)) return;
    if (!confirm(`Delete "${session.title}"?`)) return;
    setError('');
    const { error } = await supabase.from('chat_sessions').delete().eq('id', session.id);
    if (error) { setError('Could not delete session. Please try again.'); return; }
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
      setError('');
      const { error } = await supabase.from('chat_sessions').update({ title: trimmed }).eq('id', sessionId);
      if (error) { setError('Could not rename session. Please try again.'); return; }
      updateSession(sessionId, { title: trimmed });
    }
  }

  return (
    <div
      className="flex flex-col h-full"
      style={{ width: 240, borderRight: 'var(--border-default)', background: 'var(--color-bg-darkest)', flexShrink: 0 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: 'var(--border-default)' }}>
        <span className="text-sm font-semibold" style={{ color: 'var(--color-white)' }}>{audio ? 'Recording Sessions' : 'Sessions'}</span>
        <button onClick={onNewSession} disabled={creating || loading} aria-label={audio ? 'New recording session' : 'New session'} className="p-1 rounded-lg transition-colors hover:bg-white/10 disabled:opacity-40">
          <Plus size={16} style={{ color: 'var(--color-white-muted)' }} />
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {error && <p role="alert" className="text-xs p-2" style={{ color: 'var(--color-error)' }}>{error}</p>}
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
            <SessionIcon size={32} className="mb-3 opacity-20" style={{ color: 'var(--color-white)' }} />
            <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>{loading ? 'Loading sessions…' : audio ? 'No recording sessions yet' : 'No sessions yet'}</p>
          </div>
        ) : (
          sessions.map((session) => {
            const isActive  = activeSessionId === session.id;
            const isEditing = editingId === session.id;

            return (
              <div
                key={session.id}
                role="button"
                tabIndex={0}
                aria-label={`Open ${session.title}`}
                aria-current={isActive ? 'true' : undefined}
                onKeyDown={e => {
                  if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    if (!isEditing) setActiveSessionId(session.id);
                  }
                }}
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
                  {audio ? (
                    <RecordingSessionThumbnail id={session.id} title={session.title} />
                  ) : session.thumbnail_url ? (
                    <SessionThumbnail url={session.thumbnail_url} />
                  ) : (
                    <SessionIcon size={14} style={{ color: 'var(--color-white-muted)', opacity: 0.4 }} />
                  )}
                </div>

                {/* Title + date */}
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <input
                      ref={editRef}
                      aria-label="Session title"
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
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity shrink-0">
                  {isEditing ? (
                    <button
                      aria-label="Save session title"
                      onClick={e => { e.stopPropagation(); commitEdit(session.id); }}
                      className="p-0.5 rounded"
                    >
                      <Check size={12} style={{ color: 'var(--color-accent)' }} />
                    </button>
                  ) : (
                    <button onClick={e => startEdit(session, e)} aria-label={`Rename ${session.title}`} className="p-0.5 rounded hover:bg-white/10">
                      <Pencil size={11} style={{ color: 'var(--color-white-muted)' }} />
                    </button>
                  )}
                  <button onClick={e => handleDelete(session, e)} aria-label={`Delete ${session.title}`} disabled={isSessionBusy?.(session.id)} title={isSessionBusy?.(session.id) ? 'Wait for audio generation to finish' : 'Delete session'} className="p-0.5 rounded hover:bg-white/10 disabled:opacity-30">
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
