'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Loader2, Music } from 'lucide-react';
import { isAudioPending, useAudioStore } from '@/lib/stores/audioStore';
import { useGalleryStore } from '@/lib/stores/galleryStore';
import { createRecordingSession, generateRecordingBatch, loadRecordingGenerations, loadRecordingSessions } from '@/lib/audioGeneration';
import { SessionListPanel } from '@/components/chat/SessionList';
import { GenerationGrid } from '@/components/chat/GenerationGrid';
import { GenerationModal } from '@/components/chat/GenerationModal';
import { AudioComposer } from '@/components/audio/AudioComposer';
import type { Generation } from '@/types';
import styles from '@/components/chat/ImageVideo.module.css';
import audio from '@/components/audio/Audio.module.css';

export default function AudioPage() {
  const { sessions, activeSessionId, setActiveSessionId, updateSession, removeSession,
    generations, removeGeneration, isSubmitting } = useAudioStore();
  const [loading, setLoading] = useState(true);
  const [sessionReload, setSessionReload] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [creating, setCreating] = useState(false);
  const [loadedSessionId, setLoadedSessionId] = useState<string | null>(null);
  const [generationLoadError, setGenerationLoadError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState('');
  const [itemsPerRow, setItemsPerRow] = useState(4);
  const feedRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const creatingRef = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedGeneration = selectedId ? generations[selectedId] : null;

  useLayoutEffect(() => {
    const feed = feedRef.current;
    const dock = dockRef.current;
    if (!feed || !dock) return;
    const observer = new ResizeObserver(() => {
      feed.style.setProperty('--composer-height', `${dock.offsetHeight}px`);
      setItemsPerRow(Math.max(1, Math.min(4, Math.floor(feed.clientWidth / 220))));
    });
    observer.observe(feed);
    observer.observe(dock);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  useEffect(() => {
    let cancelled = false;
    loadRecordingSessions().then(sessions => {
      if (cancelled) return;
      useAudioStore.getState().setSessions(sessions);
      setLoadError('');
    }).catch(error => {
      if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Could not load recording sessions.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sessionReload]);

  useEffect(() => {
    if (!activeSessionId) return;
    let cancelled = false;
    loadRecordingGenerations(activeSessionId).then(() => {
      if (!cancelled) { setLoadedSessionId(activeSessionId); setGenerationLoadError(''); }
    }).catch(error => {
      if (!cancelled) { setLoadedSessionId(activeSessionId); setGenerationLoadError(error.message); }
    });
    return () => { cancelled = true; };
  }, [activeSessionId]);

  function notify(message: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(''), 3000);
  }

  async function newSession() {
    if (creatingRef.current || useAudioStore.getState().isSubmitting) return;
    creatingRef.current = true;
    setCreating(true);
    try { await createRecordingSession(); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not create session.'); }
    finally { creatingRef.current = false; setCreating(false); }
  }

  async function deleteRecording(generation: Generation) {
    if (!confirm('Delete this recording?')) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/generations/${generation.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not delete recording.');
      removeGeneration(generation.id);
      useGalleryStore.getState().removeGeneration(generation.id);
      setSelectedId(null);
    } catch { notify('Could not delete recording. Please try again.'); }
    finally { setDeleting(false); }
  }

  const recordings = Object.values(generations)
    .filter(generation => generation.source_type === 'chat' && generation.media_type === 'audio' && generation.source_id === activeSessionId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const loadingRecordings = !!activeSessionId && loadedSessionId !== activeSessionId;

  return (
    <div className={styles.workspace}>
      <div className={styles.sessions}>
        <SessionListPanel audio {...{ sessions, activeSessionId, setActiveSessionId, updateSession, removeSession, loading }}
          creating={creating || isSubmitting} onNewSession={newSession}
          isSessionBusy={id => isSubmitting || Object.values(generations).some(generation => generation.source_id === id && isAudioPending(generation))} />
      </div>
      <div ref={feedRef} className={styles.feed}>
        {toast && <div className={styles.toast} role="status">{toast}</div>}
        <div className={styles.scroll}>
          {loadError && <div className={audio.notice} role="alert">{loadError}<button onClick={() => setSessionReload(value => value + 1)}>Retry</button></div>}
          {generationLoadError && !loadingRecordings && <div className={audio.notice} role="alert">
            {generationLoadError}<button onClick={() => activeSessionId && loadRecordingGenerations(activeSessionId)
              .then(() => setGenerationLoadError('')).catch(error => setGenerationLoadError(error.message))}>Retry</button>
          </div>}
          {recordings.length > 0 ? (
            <GenerationGrid generations={recordings} itemsPerRow={itemsPerRow} onSelect={generation => setSelectedId(generation.id)}
              onCopyPrompt={prompt => navigator.clipboard.writeText(prompt).then(() => notify('Copied to clipboard')).catch(() => notify('Could not copy prompt'))} />
          ) : (
            <div className={styles.empty} role="status">
              {loading || loadingRecordings || isSubmitting ? <Loader2 size={24} className="animate-spin" /> : <Music size={24} />}
              <span>{loading || loadingRecordings ? 'Loading recordings…' : isSubmitting ? 'Starting your recordings…' : 'No recordings yet'}</span>
            </div>
          )}
        </div>
        <div ref={dockRef} className={styles.dock}>
          <AudioComposer onSubmit={generateRecordingBatch} disabled={loading || creating || !!loadError} />
        </div>
      </div>
      {selectedGeneration && <GenerationModal key={selectedGeneration.id} generation={selectedGeneration}
        onClose={() => setSelectedId(null)} onDelete={deleteRecording} deleting={deleting}
        detailsStatus={selectedGeneration.status === 'failed' ? selectedGeneration.error_message || 'Generation failed' : undefined} />}
    </div>
  );
}
