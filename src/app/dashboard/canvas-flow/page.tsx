'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, MoreHorizontal, Clock, Workflow } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { Flow } from '@/types';
import { cn } from '@/lib/utils/cn';
import { formatDistanceToNow } from '@/lib/utils/date';

const TEMPLATES = [
  {
    id: 'tpl-moodboard',
    title: 'Moodboard',
    description: 'Generate multiple images from a single prompt',
    color: 'from-blue-500/20 to-purple-500/20',
    icon: '🎨',
  },
  {
    id: 'tpl-upscale',
    title: 'Upscale',
    description: 'Enhance image resolution with AI upscaling',
    color: 'from-emerald-500/20 to-cyan-500/20',
    icon: '✨',
  },
];

const TEMPLATE_FLOW_DATA = {
  'tpl-moodboard': {
    nodes: [
      {
        id: 'prompt-1',
        type: 'promptNode',
        position: { x: 100, y: 200 },
        data: { prompt: 'A serene mountain landscape at golden hour' },
      },
      {
        id: 'img-gen-1',
        type: 'imageGenNode',
        position: { x: 420, y: 150 },
        data: {
          model: 'flux-2-pro',
          aspectRatio: '1:1',
          resolution: '1K',
          numImages: 4,
          status: 'idle',
        },
      },
      {
        id: 'output-1',
        type: 'outputNode',
        position: { x: 760, y: 200 },
        data: { label: 'Output' },
      },
    ],
    edges: [
      { id: 'e1', source: 'prompt-1', target: 'img-gen-1', sourceHandle: 'prompt', targetHandle: 'prompt', animated: true },
      { id: 'e2', source: 'img-gen-1', target: 'output-1', sourceHandle: 'image', targetHandle: 'image', animated: true },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
  'tpl-upscale': {
    nodes: [
      {
        id: 'img-input-1',
        type: 'imageInputNode',
        position: { x: 100, y: 200 },
        data: { label: 'Image Input' },
      },
      {
        id: 'upscale-1',
        type: 'upscaleNode',
        position: { x: 420, y: 150 },
        data: {
          model: 'seedvr2',
          scaleFactor: 2,
          status: 'idle',
        },
      },
      {
        id: 'output-1',
        type: 'outputNode',
        position: { x: 760, y: 200 },
        data: { label: 'Output' },
      },
    ],
    edges: [
      { id: 'e1', source: 'img-input-1', target: 'upscale-1', sourceHandle: 'image', targetHandle: 'image', animated: true },
      { id: 'e2', source: 'upscale-1', target: 'output-1', sourceHandle: 'image', targetHandle: 'image', animated: true },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
};

export default function CanvasFlowPage() {
  const router = useRouter();
  const [flows, setFlows] = useState<Flow[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const supabase = createClient();

  const loadFlows = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from('flows')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_template', false)
      .order('updated_at', { ascending: false });

    setFlows(data ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadFlows();
  }, [loadFlows]);

  async function createNewFlow(title = 'Untitled Flow', flowData: Record<string, unknown> = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('flows')
      .insert({
        user_id: user.id,
        title,
        flow_data: flowData,
        is_template: false,
      })
      .select()
      .single();

    if (!error && data) {
      router.push(`/dashboard/canvas-flow/${data.id}`);
    }
  }

  async function createFromTemplate(templateId: string) {
    const template = TEMPLATES.find((t) => t.id === templateId);
    if (!template) return;
    const flowData = TEMPLATE_FLOW_DATA[templateId as keyof typeof TEMPLATE_FLOW_DATA];
    await createNewFlow(template.title, flowData);
  }

  async function renameFlow(id: string, newTitle: string) {
    await supabase.from('flows').update({ title: newTitle, updated_at: new Date().toISOString() }).eq('id', id);
    setFlows(flows.map((f) => (f.id === id ? { ...f, title: newTitle } : f)));
  }

  async function deleteFlow(id: string) {
    await supabase.from('flows').delete().eq('id', id);
    setFlows(flows.filter((f) => f.id !== id));
  }

  const filteredFlows = flows.filter((f) =>
    f.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div
      className="h-full overflow-auto p-8"
      onClick={() => setMenuOpenId(null)}
    >
      {/* Base Flows (Templates) */}
      <section className="mb-10">
        <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-white-muted)' }}>
          BASE FLOWS
        </h2>
        <div className="flex gap-4 overflow-x-auto pb-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => createFromTemplate(t.id)}
              className={cn(
                'flex-shrink-0 w-48 h-36 rounded-xl p-4 text-left transition-all duration-150 hover:scale-[1.02] hover:opacity-90',
                `bg-gradient-to-br ${t.color}`
              )}
              style={{ border: 'var(--border-default)' }}
            >
              <div className="text-2xl mb-2">{t.icon}</div>
              <p className="text-sm font-semibold" style={{ color: 'var(--color-white)' }}>
                {t.title}
              </p>
              <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-white-muted)' }}>
                {t.description}
              </p>
            </button>
          ))}
        </div>
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
              <div
                key={i}
                className="h-44 rounded-xl animate-pulse"
                style={{ background: 'var(--color-bg-elevated)' }}
              />
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
  );
}

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
    <div
      className="relative group rounded-xl overflow-hidden cursor-pointer transition-all duration-150 hover:scale-[1.02]"
      style={{ border: 'var(--border-default)', background: 'var(--color-bg-elevated)' }}
      onClick={onOpen}
    >
      {/* Thumbnail area */}
      <div
        className="h-28 flex items-center justify-center"
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
          <p
            className="text-sm font-medium leading-tight truncate flex-1"
            style={{ color: 'var(--color-white)' }}
          >
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

      {/* Context menu */}
      {menuOpen && (
        <div
          className="absolute right-2 bottom-2 z-10 w-36 rounded-lg overflow-hidden shadow-lg"
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
    </div>
  );
}
