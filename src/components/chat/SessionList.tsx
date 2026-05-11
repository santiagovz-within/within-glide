'use client';

import { Plus, MessageSquare, Trash2 } from 'lucide-react';
import { useChatStore } from '@/lib/stores/chatStore';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';
import { formatDistanceToNow } from '@/lib/utils/date';
import type { ChatSession } from '@/types';

interface SessionListProps {
  onNewSession: () => void;
}

export function SessionList({ onNewSession }: SessionListProps) {
  const { sessions, activeSessionId, setActiveSessionId, removeSession } = useChatStore();
  const supabase = createClient();

  async function handleDelete(session: ChatSession, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Delete "${session.title}"?`)) return;
    await supabase.from('chat_sessions').delete().eq('id', session.id);
    removeSession(session.id);
    if (activeSessionId === session.id && sessions.length > 1) {
      const next = sessions.find((s) => s.id !== session.id);
      setActiveSessionId(next?.id ?? null);
    }
  }

  return (
    <div
      className="flex flex-col h-full"
      style={{
        width: 240,
        borderRight: 'var(--border-default)',
        background: 'var(--color-bg-darkest)',
        flexShrink: 0,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: 'var(--border-default)' }}
      >
        <span className="text-sm font-semibold" style={{ color: 'var(--color-white)' }}>
          Sessions
        </span>
        <button
          onClick={onNewSession}
          className="p-1 rounded-lg transition-colors hover:bg-white/10"
        >
          <Plus size={16} style={{ color: 'var(--color-white-muted)' }} />
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
            <MessageSquare size={32} className="mb-3 opacity-20" style={{ color: 'var(--color-white)' }} />
            <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>
              No sessions yet
            </p>
          </div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className={cn(
                'group flex items-start justify-between gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors mb-0.5',
                activeSessionId === session.id ? 'bg-white/10' : 'hover:bg-white/5'
              )}
              onClick={() => setActiveSessionId(session.id)}
            >
              <div className="flex-1 min-w-0">
                <p
                  className="text-sm truncate"
                  style={{ color: activeSessionId === session.id ? 'var(--color-white)' : 'var(--color-white-muted)' }}
                >
                  {session.title}
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-white-muted)' }}>
                  {formatDistanceToNow(session.updated_at)}
                </p>
              </div>
              <button
                onClick={(e) => handleDelete(session, e)}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded mt-0.5"
              >
                <Trash2 size={12} style={{ color: 'var(--color-white-muted)' }} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
