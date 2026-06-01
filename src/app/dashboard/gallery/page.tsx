'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Grid, X, Download, Trash2, Play } from 'lucide-react';
import { useGalleryStore } from '@/lib/stores/galleryStore';
import { createClient } from '@/lib/supabase/client';
import type { Generation } from '@/types';
import { formatDate } from '@/lib/utils/date';
import { resolveGcsRefs } from '@/lib/utils/mediaUtils';
import { ProgressiveImage } from '@/components/ui/ProgressiveImage';

const PAGE_SIZE = 60;

export default function GalleryPage() {
  const { generations, setGenerations, removeGeneration, filter, setFilter, sort, setSort, isLoading, setIsLoading } = useGalleryStore();
  const [selectedGen, setSelectedGen] = useState<Generation | null>(null);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const supabase = useRef(createClient()).current;
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPage() {
      setIsLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) { setIsLoading(false); return; }

      let query = supabase
        .from('generations')
        .select('*', { count: 'exact' })
        .eq('user_id', user.id)
        .eq('status', 'completed')
        .neq('media_type', 'prompt');

      if (filter !== 'all') query = query.eq('media_type', filter);

      const { data, count } = await query
        .order('created_at', { ascending: sort === 'oldest' })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (cancelled) return;

      setTotalCount(count ?? 0);

      const rows = data ?? [];
      const gcsMap = await resolveGcsRefs(rows.map((g) => g.media_url));
      if (cancelled) return;

      setGenerations(
        rows.map((g) => gcsMap.has(g.media_url) ? { ...g, media_url: gcsMap.get(g.media_url)! } : g)
      );
      setIsLoading(false);
    }

    loadPage();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filter, sort, refreshKey]);

  // Scroll grid to top when page changes
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [page]);

  function handleFilterChange(f: typeof filter) {
    setPage(0);
    setFilter(f);
  }

  function handleSortChange(s: typeof sort) {
    setPage(0);
    setSort(s);
  }

  async function handleDelete(gen: Generation) {
    if (!confirm('Delete this generation?')) return;
    await fetch(`/api/generations/${gen.id}`, { method: 'DELETE' });
    removeGeneration(gen.id);
    if (selectedGen?.id === gen.id) setSelectedGen(null);
    // If we just removed the last item on a non-first page, go back one page
    if (generations.length === 1 && page > 0) {
      setPage(p => p - 1);
    } else {
      setRefreshKey(k => k + 1);
    }
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-5" style={{ borderBottom: 'var(--border-default)' }}>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-white)' }}>Gallery</h1>
        <div className="flex items-center gap-3">
          {/* Filter */}
          <div
            className="flex rounded-lg p-0.5 gap-0.5"
            style={{ background: 'var(--color-bg-elevated)', border: 'var(--border-default)' }}
          >
            {(['all', 'image', 'video'] as const).map((f) => (
              <button
                key={f}
                onClick={() => handleFilterChange(f)}
                className="px-3 py-1 rounded-md text-xs font-medium transition-all capitalize"
                style={{
                  background: filter === f ? 'var(--color-bg-hover)' : 'transparent',
                  color: filter === f ? 'var(--color-white)' : 'var(--color-white-muted)',
                }}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Sort */}
          <select
            className="px-3 py-1.5 rounded-lg text-xs outline-none"
            value={sort}
            onChange={(e) => handleSortChange(e.target.value as 'newest' | 'oldest')}
            style={{ background: 'var(--color-bg-elevated)', border: 'var(--border-default)', color: 'var(--color-white)' }}
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
        </div>
      </div>

      {/* Grid + pagination */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-8 py-6 flex flex-col">
        {isLoading ? (
          <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="rounded-xl animate-pulse" style={{ aspectRatio: '1', background: 'var(--color-bg-elevated)' }} />
            ))}
          </div>
        ) : generations.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 py-20">
            <Grid size={48} className="mb-4 opacity-20" style={{ color: 'var(--color-white)' }} />
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-white)' }}>
              {filter !== 'all' ? `No ${filter}s yet` : 'No generations yet'}
            </p>
            <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>
              Generate images or videos from Canvas Flow or Image & Video
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {generations.map((gen) => (
                <GalleryThumbnail
                  key={gen.id}
                  generation={gen}
                  onClick={() => setSelectedGen(gen)}
                />
              ))}
            </div>

            {/* Pagination controls */}
            {totalPages > 1 && (
              <div
                className="flex items-center justify-center gap-4 mt-6 pt-5 shrink-0"
                style={{ borderTop: 'var(--border-default)' }}
              >
                <button
                  onClick={() => setPage(p => p - 1)}
                  disabled={page === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity disabled:opacity-30 hover:opacity-70"
                  style={{ background: 'var(--color-bg-elevated)', border: 'var(--border-default)', color: 'var(--color-white-muted)' }}
                >
                  <ChevronLeft size={13} />
                  Prev
                </button>

                <span className="text-xs tabular-nums" style={{ color: 'var(--color-white-muted)' }}>
                  Page {page + 1} of {totalPages}
                  <span className="ml-2 opacity-50">({totalCount} total)</span>
                </span>

                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={page >= totalPages - 1}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity disabled:opacity-30 hover:opacity-70"
                  style={{ background: 'var(--color-bg-elevated)', border: 'var(--border-default)', color: 'var(--color-white-muted)' }}
                >
                  Next
                  <ChevronRight size={13} />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Detail modal */}
      {selectedGen && (
        <GenerationModal
          generation={selectedGen}
          onClose={() => setSelectedGen(null)}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}

function GalleryThumbnail({ generation, onClick }: { generation: Generation; onClick: () => void }) {
  const isVideo = generation.media_type === 'video';
  return (
    <div
      className="relative group rounded-xl overflow-hidden cursor-pointer transition-all duration-150 hover:scale-[1.03] hover:shadow-lg"
      style={{ aspectRatio: '1', border: 'var(--border-default)' }}
      onClick={onClick}
    >
      {isVideo ? (
        <video src={generation.media_url} className="w-full h-full object-cover" preload="metadata" />
      ) : (
        <ProgressiveImage
          src={generation.media_url}
          alt={generation.prompt ?? ''}
          className="w-full h-full object-cover"
          fill
        />
      )}

      {isVideo && (
        <div className="absolute inset-0 flex items-center justify-center opacity-60 group-hover:opacity-100">
          <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
            <Play size={12} style={{ color: '#fff' }} />
          </div>
        </div>
      )}

      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2"
        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 50%)' }}
      >
        <p className="text-xs truncate" style={{ color: '#fff' }}>{generation.model}</p>
        <p className="text-xs opacity-60" style={{ color: '#fff' }}>{formatDate(generation.created_at)}</p>
      </div>
    </div>
  );
}

function GenerationModal({
  generation,
  onClose,
  onDelete,
}: {
  generation: Generation;
  onClose: () => void;
  onDelete: (g: Generation) => void;
}) {
  const isVideo = generation.media_type === 'video';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-8"
      style={{ background: 'rgba(0,0,0,0.8)' }}
      onClick={onClose}
    >
      <div
        className="relative flex gap-6 max-w-4xl w-full rounded-2xl overflow-hidden"
        style={{
          background: 'var(--color-bg-elevated)',
          border: 'var(--border-default)',
          boxShadow: 'var(--shadow-modal)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Media */}
        <div className="flex-1 min-w-0" style={{ maxWidth: '60%' }}>
          {isVideo ? (
            <video src={generation.media_url} controls className="w-full h-full object-contain" style={{ maxHeight: '70vh' }} />
          ) : (
            <ProgressiveImage
              src={generation.media_url}
              alt=""
              className="w-full h-full object-contain"
              style={{ maxHeight: '70vh' }}
            />
          )}
        </div>

        {/* Metadata */}
        <div className="w-72 flex-shrink-0 p-6 flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-white)' }}>Details</h2>
            <button onClick={onClose} className="p-1 rounded transition-opacity hover:opacity-60">
              <X size={16} style={{ color: 'var(--color-white-muted)' }} />
            </button>
          </div>

          <div className="space-y-4 flex-1">
            <MetaRow label="Model" value={generation.model} />
            <MetaRow label="Type" value={generation.media_type} />
            <MetaRow label="Date" value={formatDate(generation.created_at)} />
            {generation.prompt && (
              <div>
                <p className="text-xs font-medium mb-1" style={{ color: 'var(--color-white-muted)' }}>Prompt</p>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--color-white)' }}>{generation.prompt}</p>
              </div>
            )}
            {(generation.width && generation.height) && (
              <MetaRow label="Size" value={`${generation.width} × ${generation.height}`} />
            )}
          </div>

          <div className="flex gap-2 mt-6">
            <a
              href={generation.media_url}
              download
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-opacity hover:opacity-80"
              style={{ background: 'var(--color-accent)', color: '#fff' }}
            >
              <Download size={12} />
              Download
            </a>
            <button
              onClick={() => onDelete(generation)}
              className="p-2 rounded-lg transition-opacity hover:opacity-80"
              style={{ border: '1px solid var(--color-error)', color: 'var(--color-error)' }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium mb-0.5" style={{ color: 'var(--color-white-muted)' }}>{label}</p>
      <p className="text-xs capitalize" style={{ color: 'var(--color-white)' }}>{value}</p>
    </div>
  );
}
