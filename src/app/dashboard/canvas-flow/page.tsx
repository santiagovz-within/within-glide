'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus, Search, MoreHorizontal, Clock, Workflow,
  Edit2, Check, X, Upload, RefreshCw,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { Flow } from '@/types';
import { formatDistanceToNow } from '@/lib/utils/date';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Splits "🎨 Subtitle text" into { icon, text } */
function parseDescription(raw: string | null): { icon: string | null; text: string | null } {
  if (!raw) return { icon: null, text: null };
  const m = raw.match(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic})\s*/u);
  if (m) return { icon: m[1], text: raw.slice(m[0].length).trim() || null };
  return { icon: null, text: raw };
}

// ── Shared card shell that prevents hover-scale clipping ─────────────────────
// overflow-hidden is on the thumbnail only; the card wrapper itself is overflow-visible
// so scaled cards never clip against the grid.

function CardShell({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      className="relative group rounded-xl cursor-pointer transition-all duration-150 hover:scale-[1.02]"
      style={{
        border: 'var(--border-default)',
        background: 'var(--color-bg-elevated)',
        // keep shadow inside the transform but NOT overflow:hidden — that causes the clipping
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
      }}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

// ── Inline edit overlay for base flow cards (admins only) ────────────────────

interface EditOverlayProps {
  flow: Flow;
  onSave: (updates: { title: string; description: string; thumbnail_url: string | null }) => Promise<void>;
  onClose: () => void;
}

function EditOverlay({ flow, onSave, onClose }: EditOverlayProps) {
  const { icon: existingIcon, text: existingText } = parseDescription(flow.description);
  const [title, setTitle] = useState(flow.title);
  const [icon, setIcon] = useState(existingIcon ?? '');
  const [description, setDescription] = useState(existingText ?? '');
  const [thumbnailUrl, setThumbnailUrl] = useState(flow.thumbnail_url ?? '');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const supabase = createClient();

  async function handleUpload(file: File) {
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const { url } = await res.json();
      if (url) setThumbnailUrl(url);
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    const combinedDescription = [icon.trim(), description.trim()].filter(Boolean).join(' ');
    await onSave({
      title: title.trim() || flow.title,
      description: combinedDescription || null as unknown as string,
      thumbnail_url: thumbnailUrl.trim() || null,
    });
    setSaving(false);
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--color-bg-surface)',
    border: 'var(--border-default)',
    color: 'var(--color-white)',
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 12,
    outline: 'none',
    width: '100%',
  };

  return (
    <div
      className="absolute inset-0 z-20 rounded-xl p-3 flex flex-col gap-2"
      style={{
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-accent)',
        backdropFilter: 'blur(8px)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-semibold" style={{ color: 'var(--color-white)' }}>Edit Base Flow</p>
        <button onClick={onClose} className="p-0.5 rounded hover:bg-white/10">
          <X size={12} style={{ color: 'var(--color-white-muted)' }} />
        </button>
      </div>

      {/* Icon + Title row */}
      <div className="flex gap-1.5">
        <input
          type="text"
          placeholder="🎨"
          value={icon}
          onChange={(e) => setIcon(e.target.value)}
          maxLength={4}
          style={{ ...inputStyle, width: 40, textAlign: 'center', flexShrink: 0 }}
          title="Emoji icon"
        />
        <input type="text" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
      </div>

      {/* Description */}
      <input type="text" placeholder="Short description" value={description} onChange={(e) => setDescription(e.target.value)} style={inputStyle} />

      {/* Thumbnail */}
      <div className="flex gap-1.5">
        <input
          type="text"
          placeholder="Thumbnail URL"
          value={thumbnailUrl}
          onChange={(e) => setThumbnailUrl(e.target.value)}
          style={{ ...inputStyle, flex: 1 }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex items-center justify-center rounded-lg transition-colors hover:bg-white/10 disabled:opacity-40"
          style={{ border: 'var(--border-default)', width: 30, height: 30, flexShrink: 0 }}
          title="Upload image"
        >
          {uploading ? <RefreshCw size={11} className="animate-spin" style={{ color: 'var(--color-white-muted)' }} /> : <Upload size={11} style={{ color: 'var(--color-white-muted)' }} />}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }}
        />
      </div>

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
        style={{ background: '#fff', color: '#000' }}
      >
        {saving ? <RefreshCw size={11} className="animate-spin" /> : <Check size={11} />}
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CanvasFlowPage() {
  const router = useRouter();
  const [flows, setFlows]         = useState<Flow[]>([]);
  const [baseFlows, setBaseFlows] = useState<Flow[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading]     = useState(true);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [editingBaseId, setEditingBaseId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin]     = useState(false);

  const supabase = createClient();

  const loadFlows = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [userFlowsResult, baseFlowsResult, profileResult] = await Promise.all([
      supabase
        .from('flows')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_template', false)
        .order('updated_at', { ascending: false }),
      fetch('/api/flows/base').then((r) => r.json()).catch(() => ({ baseFlows: [] })),
      supabase.from('profiles').select('is_admin').eq('id', user.id).single(),
    ]);

    setFlows(userFlowsResult.data ?? []);
    setBaseFlows(baseFlowsResult.baseFlows ?? []);
    setIsAdmin(profileResult.data?.is_admin ?? false);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadFlows(); }, [loadFlows]);

  async function createNewFlow(
    title = 'Untitled Flow',
    flowData: Record<string, unknown> = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
  ) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase
      .from('flows')
      .insert({ user_id: user.id, title, flow_data: flowData, is_template: false })
      .select()
      .single();
    if (!error && data) router.push(`/dashboard/canvas-flow/${data.id}`);
  }

  async function renameFlow(id: string, newTitle: string) {
    await supabase.from('flows').update({ title: newTitle, updated_at: new Date().toISOString() }).eq('id', id);
    setFlows(flows.map((f) => (f.id === id ? { ...f, title: newTitle } : f)));
  }

  async function deleteFlow(id: string) {
    await supabase.from('flows').delete().eq('id', id);
    setFlows(flows.filter((f) => f.id !== id));
  }

  async function saveBaseFlowEdits(
    id: string,
    updates: { title: string; description: string; thumbnail_url: string | null }
  ) {
    await supabase.from('flows').update({
      title: updates.title,
      description: updates.description,
      thumbnail_url: updates.thumbnail_url,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    setBaseFlows(baseFlows.map((f) =>
      f.id === id ? { ...f, ...updates } : f
    ));
    setEditingBaseId(null);
  }

  async function deleteBaseFlow(id: string, title: string) {
    if (!confirm(`Delete base flow "${title}"? This cannot be undone.`)) return;
    await supabase.from('flows').delete().eq('id', id);
    setBaseFlows(baseFlows.filter((f) => f.id !== id));
  }

  async function unmarkBaseFlow(id: string) {
    await supabase.from('flows').update({ is_template: false }).eq('id', id);
    setBaseFlows(baseFlows.filter((f) => f.id !== id));
  }

  const filteredFlows = flows.filter((f) =>
    f.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div
      className="h-full overflow-auto p-8"
      onClick={() => { setMenuOpenId(null); setEditingBaseId(null); }}
    >
      <div className="max-w-6xl mx-auto">
      {/* Base Flows */}
      <section className="mb-10">
        <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-white-muted)' }}>
          BASE FLOWS
        </h2>

        {baseFlows.length === 0 ? (
          <div
            className="flex items-center gap-3 px-4 py-5 rounded-xl"
            style={{ border: '1.5px dashed rgba(255,255,255,0.1)' }}
          >
            <Workflow size={20} className="opacity-30" style={{ color: 'var(--color-white)' }} />
            <p className="text-sm" style={{ color: 'var(--color-white-muted)' }}>
              No base flows yet — admins can mark any flow as a base from the editor.
            </p>
          </div>
        ) : (
          // Same grid as recent flows — no horizontal scroll, no overflow:hidden parent to clip hovers
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {baseFlows.map((bf) => {
              const { icon, text } = parseDescription(bf.description);
              const isEditing = editingBaseId === bf.id;
              const menuOpen  = menuOpenId === bf.id;

              return (
                <CardShell
                  key={bf.id}
                  onClick={() => {
                    if (isEditing || menuOpen) return;
                    createNewFlow(bf.title, bf.flow_data as unknown as Record<string, unknown>);
                  }}
                >
                  {/* Thumbnail area */}
                  <div
                    className="aspect-video flex items-center justify-center rounded-t-xl overflow-hidden"
                    style={{ background: 'var(--color-bg-surface)' }}
                  >
                    {bf.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={bf.thumbnail_url} alt={bf.title} className="w-full h-full object-cover" />
                    ) : icon ? (
                      <span style={{ fontSize: 36 }}>{icon}</span>
                    ) : (
                      <Workflow size={32} className="opacity-20" style={{ color: 'var(--color-white)' }} />
                    )}
                  </div>

                  {/* Footer */}
                  <div className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-tight truncate" style={{ color: 'var(--color-white)' }}>
                          {bf.title}
                        </p>
                        {text && (
                          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-white-muted)' }}>{text}</p>
                        )}
                      </div>
                      {isAdmin && (
                        <button
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpenId(menuOpen ? null : bf.id);
                            setEditingBaseId(null);
                          }}
                        >
                          <MoreHorizontal size={14} style={{ color: 'var(--color-white-muted)' }} />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      <Clock size={10} style={{ color: 'var(--color-white-muted)' }} />
                      <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>
                        {formatDistanceToNow(bf.updated_at)}
                      </p>
                    </div>
                  </div>

                  {/* Admin context menu */}
                  {menuOpen && isAdmin && (
                    <div
                      className="absolute right-2 bottom-2 z-10 w-40 rounded-lg overflow-hidden shadow-lg"
                      style={{ background: 'var(--color-bg-surface)', border: 'var(--border-default)' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        className="w-full text-left px-3 py-2 text-xs transition-colors hover:bg-white/5 flex items-center gap-2"
                        style={{ color: 'var(--color-white)' }}
                        onClick={(e) => { e.stopPropagation(); setEditingBaseId(bf.id); setMenuOpenId(null); }}
                      >
                        <Edit2 size={11} /> Edit thumbnail & icon
                      </button>
                      <button
                        className="w-full text-left px-3 py-2 text-xs transition-colors hover:bg-white/5"
                        style={{ color: 'var(--color-white)' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpenId(null);
                          router.push(`/dashboard/canvas-flow/${bf.id}`);
                        }}
                      >
                        Open in editor
                      </button>
                      <button
                        className="w-full text-left px-3 py-2 text-xs transition-colors hover:bg-white/5"
                        style={{ color: 'var(--color-white-muted)' }}
                        onClick={(e) => { e.stopPropagation(); setMenuOpenId(null); unmarkBaseFlow(bf.id); }}
                      >
                        Remove from base flows
                      </button>
                      <button
                        className="w-full text-left px-3 py-2 text-xs transition-colors hover:bg-white/5"
                        style={{ color: 'var(--color-error)' }}
                        onClick={(e) => { e.stopPropagation(); setMenuOpenId(null); deleteBaseFlow(bf.id, bf.title); }}
                      >
                        Delete
                      </button>
                    </div>
                  )}

                  {/* Inline edit overlay */}
                  {isEditing && (
                    <EditOverlay
                      flow={bf}
                      onSave={(updates) => saveBaseFlowEdits(bf.id, updates)}
                      onClose={() => setEditingBaseId(null)}
                    />
                  )}
                </CardShell>
              );
            })}
          </div>
        )}
      </section>

      {/* Recent Flows */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-white-muted)' }}>
            RECENT FLOWS
          </h2>
          <button
            onClick={() => createNewFlow()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-80"
            style={{ background: '#fff', color: '#000' }}
          >
            <Plus size={14} />
            New Flow
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--color-white-muted)' }}
          />
          <input
            type="text"
            placeholder="Search flows..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full max-w-xs pl-9 pr-3 py-2 rounded-lg text-sm outline-none"
            style={{
              background: 'var(--color-bg-elevated)',
              border: 'var(--border-default)',
              color: 'var(--color-white)',
            }}
          />
        </div>

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-44 rounded-xl animate-pulse" style={{ background: 'var(--color-bg-elevated)' }} />
            ))}
          </div>
        ) : filteredFlows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Workflow size={48} className="mb-4 opacity-20" style={{ color: 'var(--color-white)' }} />
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-white)' }}>
              {searchQuery ? 'No flows match your search' : 'No flows yet'}
            </p>
            <p className="text-xs mb-4" style={{ color: 'var(--color-white-muted)' }}>
              {searchQuery ? 'Try a different search term' : 'Create your first flow to get started'}
            </p>
            {!searchQuery && (
              <button
                onClick={() => createNewFlow()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-80"
                style={{ background: '#fff', color: '#000' }}
              >
                <Plus size={14} />
                New Flow
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredFlows.map((flow) => (
              <FlowCard
                key={flow.id}
                flow={flow}
                menuOpen={menuOpenId === flow.id}
                onMenuToggle={(e) => {
                  e.stopPropagation();
                  setMenuOpenId(menuOpenId === flow.id ? null : flow.id);
                }}
                onOpen={() => router.push(`/dashboard/canvas-flow/${flow.id}`)}
                onRename={() => {
                  const newTitle = prompt('Rename flow:', flow.title);
                  if (newTitle?.trim()) renameFlow(flow.id, newTitle.trim());
                }}
                onDelete={() => {
                  if (confirm(`Delete "${flow.title}"?`)) deleteFlow(flow.id);
                }}
              />
            ))}
          </div>
        )}
      </section>
      </div>
    </div>
  );
}

// ── Recent flow card ──────────────────────────────────────────────────────────

function FlowCard({
  flow,
  menuOpen,
  onMenuToggle,
  onOpen,
  onRename,
  onDelete,
}: {
  flow: Flow;
  menuOpen: boolean;
  onMenuToggle: (e: React.MouseEvent) => void;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <CardShell onClick={onOpen}>
      {/* Thumbnail */}
      <div
        className="aspect-video flex items-center justify-center rounded-t-xl overflow-hidden"
        style={{ background: 'var(--color-bg-surface)' }}
      >
        {flow.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={flow.thumbnail_url} alt={flow.title} className="w-full h-full object-cover" />
        ) : (
          <Workflow size={32} className="opacity-20" style={{ color: 'var(--color-white)' }} />
        )}
      </div>

      {/* Footer */}
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-tight truncate flex-1" style={{ color: 'var(--color-white)' }}>
            {flow.title}
          </p>
          <button
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded"
            onClick={onMenuToggle}
          >
            <MoreHorizontal size={14} style={{ color: 'var(--color-white-muted)' }} />
          </button>
        </div>
        <div className="flex items-center gap-1 mt-1">
          <Clock size={10} style={{ color: 'var(--color-white-muted)' }} />
          <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>
            {formatDistanceToNow(flow.updated_at)}
          </p>
        </div>
      </div>

      {/* Context menu — z-20 so it layers above everything in the card */}
      {menuOpen && (
        <div
          className="absolute right-2 bottom-2 z-20 w-36 rounded-lg overflow-hidden shadow-lg"
          style={{ background: 'var(--color-bg-surface)', border: 'var(--border-default)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-3 py-2 text-sm transition-colors hover:bg-white/5"
            style={{ color: 'var(--color-white)' }}
            onClick={(e) => { e.stopPropagation(); onRename(); }}
          >
            Rename
          </button>
          <button
            className="w-full text-left px-3 py-2 text-sm transition-colors hover:bg-white/5"
            style={{ color: 'var(--color-error)' }}
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            Delete
          </button>
        </div>
      )}
    </CardShell>
  );
}
