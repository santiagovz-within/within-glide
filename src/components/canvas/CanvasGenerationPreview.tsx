'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { GenerationModal } from '@/components/chat/GenerationModal';
import { findCanvasGeneration } from '@/lib/canvasGeneration';
import { createClient } from '@/lib/supabase/client';
import { useGalleryStore } from '@/lib/stores/galleryStore';
import type { Generation, MediaType } from '@/types';

type OpenPreview = (url: string, type: MediaType) => void;
const PreviewContext = createContext<OpenPreview | null>(null);

export function useCanvasGenerationPreview() {
  return useContext(PreviewContext);
}

/** A native button makes previews accessible without enabling canvas dragging. */
export function CanvasMediaPreviewButton({ url, type }: { url: string; type: MediaType }) {
  const openPreview = useCanvasGenerationPreview();
  if (!openPreview) return null;
  return (
    <button
      type="button"
      aria-label={`View ${type} details`}
      title={`View ${type} details`}
      className="absolute inset-0 w-full h-full nodrag nopan cursor-zoom-in focus-visible:outline-2 focus-visible:outline-white focus-visible:-outline-offset-2"
      style={{ background: 'transparent', border: 0, pointerEvents: 'auto' }}
      onPointerDown={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
      onClick={event => { event.stopPropagation(); openPreview(url, type); }}
    />
  );
}

function CanvasGenerationDialog({ url, type, readOnly, onClose }: {
  url: string;
  type: MediaType;
  readOnly: boolean;
  onClose: () => void;
}) {
  const [generation, setGeneration] = useState<Generation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void findCanvasGeneration(createClient(), url, controller.signal)
      .then(result => { if (!controller.signal.aborted) setGeneration(result); })
      .catch(() => { if (!controller.signal.aborted) setError('Could not load generation details.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url, attempt]);

  async function handleDelete() {
    if (!generation || deleting || !confirm('Delete this generation?')) return;
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/generations/${generation.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Delete failed');
      useGalleryStore.getState().removeGeneration(generation.id);
      onClose();
    } catch {
      setError('Could not delete this generation. Please try again.');
    } finally {
      setDeleting(false);
    }
  }

  const detailsStatus = loading ? 'Loading generation details…' : error ? (
    <>
      {error}
      {!generation && <button
        type="button"
        className="block mt-2 underline"
        onClick={event => {
          // Retry disappears while loading; keep focus in the dialog so Escape
          // and canvas shortcut isolation continue to work after it unmounts.
          event.currentTarget.closest<HTMLElement>('[role="dialog"]')?.focus();
          setError(null);
          setLoading(true);
          setAttempt(value => value + 1);
        }}
      >Retry</button>}
    </>
  ) : !generation ? 'No saved generation details are available for this media.' : null;

  return (
    <GenerationModal
      generation={generation ?? { media_url: url, media_type: type }}
      onClose={onClose}
      onDelete={generation && !readOnly ? handleDelete : undefined}
      deleting={deleting}
      detailsStatus={detailsStatus}
    />
  );
}

export function CanvasGenerationPreviewProvider({ children, readOnly = false }: {
  children: ReactNode;
  readOnly?: boolean;
}) {
  const [selection, setSelection] = useState<{ url: string; type: MediaType } | null>(null);
  const openPreview = useCallback<OpenPreview>((url, type) => setSelection({ url, type }), []);
  const closePreview = useCallback(() => {
    // A delete finishing after the user opens another result must not close it.
    setSelection(current => current === selection ? null : current);
  }, [selection]);

  return (
    <PreviewContext.Provider value={openPreview}>
      {children}
      {selection && createPortal(
        <div
          className="fixed inset-0 nodrag nopan nowheel"
          style={{ zIndex: 9999 }}
          onPointerDown={event => event.stopPropagation()}
          onClick={event => event.stopPropagation()}
          onContextMenu={event => event.stopPropagation()}
          onWheel={event => event.stopPropagation()}
        >
          <CanvasGenerationDialog key={`${selection.type}:${selection.url}`} {...selection} readOnly={readOnly} onClose={closePreview} />
        </div>,
        document.body,
      )}
    </PreviewContext.Provider>
  );
}
