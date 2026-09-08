'use client';

import { useEffect, useLayoutEffect, useCallback, useState, useRef } from 'react';
import { useChatStore } from '@/lib/stores/chatStore';
import { useGalleryStore } from '@/lib/stores/galleryStore';
import { createClient } from '@/lib/supabase/client';
import { SessionList } from '@/components/chat/SessionList';
import { ChatInput } from '@/components/chat/ChatInput';
import { GenerationGrid } from '@/components/chat/GenerationGrid';
import { GenerationModal } from '@/components/chat/GenerationModal';
import { Images } from 'lucide-react';
import styles from '@/components/chat/ImageVideo.module.css';
import { MODELS } from '@/lib/api/models';
import type { ChatSession, ChatMessage, Generation } from '@/types';

export default function ImageVideoPage() {
  const {
    sessions, setSessions, addSession,
    activeSessionId, setActiveSessionId,
    messages, setMessages, addMessage,
    generations, addGeneration, updateGeneration,
    prompt, referenceImages,
    settings, mode,
    isGenerating, setIsGenerating,
    updateSession, removeGeneration,
  } = useChatStore();
  const [selectedGen, setSelectedGen] = useState<Generation | null>(null);
  const [toast, setToast] = useState('');
  const [itemsPerRow, setItemsPerRow] = useState(4);
  const feedRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const feed = feedRef.current;
    const dock = dockRef.current;
    if (!feed || !dock) return;
    const observer = new ResizeObserver(() => {
      feed.style.setProperty('--composer-height', `${dock.offsetHeight}px`);
      setItemsPerRow(feed.clientWidth <= 600 ? 2 : 4);
    });
    observer.observe(feed);
    observer.observe(dock);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
  }, []);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { addGeneration: addToGallery } = useGalleryStore();

  const supabase = createClient();

  // Ref so loadSessions doesn't need activeSessionId in its deps (avoids reload loop)
  const activeSessionIdRef = useRef<string | null>(activeSessionId);
  useEffect(() => { activeSessionIdRef.current = activeSessionId; }, [activeSessionId]);

  const loadSessions = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('chat_sessions')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    setSessions(data ?? []);
    if (data?.[0] && !activeSessionIdRef.current) {
      setActiveSessionId(data[0].id);
    }
  }, [supabase, setSessions, setActiveSessionId]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (!activeSessionId) return;
    async function loadMessages() {
      const { data: msgs } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('session_id', activeSessionId)
        .order('created_at', { ascending: true });
      if (msgs) setMessages(activeSessionId!, msgs);

      // Load generations for these messages
      const genIds = msgs?.flatMap((m: ChatMessage) => m.generation_ids ?? []) ?? [];
      if (genIds.length > 0) {
        const { data: gens } = await supabase
          .from('generations')
          .select('*')
          .in('id', genIds);
        gens?.forEach((g: Generation) => addGeneration(g));
      }
    }
    loadMessages();
  }, [activeSessionId, supabase, setMessages, addGeneration]);

  async function createNewSession(): Promise<string | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase
      .from('chat_sessions')
      .insert({ user_id: user.id, title: 'New Session' })
      .select()
      .single();
    if (data) {
      addSession(data as ChatSession);
      setActiveSessionId(data.id);
      return data.id;
    }
    return null;
  }

  function handleCopyPrompt(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      setToast('Copied to clipboard');
      copiedTimerRef.current = setTimeout(() => setToast(''), 1800);
    }).catch(() => setToast('Could not copy prompt'));
  }

  async function handleDelete(gen: Generation) {
    if (!confirm('Delete this generation?')) return;
    try {
      const response = await fetch(`/api/generations/${gen.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Delete failed');
      removeGeneration(gen.id);
      useGalleryStore.getState().removeGeneration(gen.id);
      setSelectedGen(null);
    } catch {
      setToast('Could not delete generation');
    }
  }

  async function handleGenerate() {
    if (!prompt.trim() || isGenerating) return;

    let sessionId = activeSessionId;
    if (!sessionId) {
      sessionId = await createNewSession();
      if (!sessionId) return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setIsGenerating(true);

    // Capture before any async saves so values are stable
    const capturedPrompt = prompt;
    const capturedRefImages = [...referenceImages];

    // Save user message (include reference images for display in history)
    const { data: userMsg } = await supabase
      .from('chat_messages')
      .insert({
        session_id: sessionId,
        user_id: user.id,
        role: 'user',
        content: capturedPrompt,
        generation_ids: [],
        reference_image_urls: capturedRefImages.length > 0 ? capturedRefImages : null,
      })
      .select()
      .single();
    if (userMsg) addMessage(sessionId, userMsg as ChatMessage);

    // Fire-and-forget title generation on first message
    const sessionMessages = messages[sessionId] ?? [];

    if (sessionMessages.length === 0) {
      fetch('/api/google/generate-title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: capturedPrompt }),
      }).then(r => r.json()).then(async ({ title }) => {
        if (title && title !== 'New Session') {
          await supabase.from('chat_sessions').update({ title, updated_at: new Date().toISOString() }).eq('id', sessionId!);
          updateSession(sessionId!, { title });
        }
      }).catch(() => {});
    }

    try {
      const modelConfig = MODELS[settings.model];
      const isGoogleImageModel = mode === 'image' && modelConfig?.provider === 'google';
      const endpoint = isGoogleImageModel ? '/api/google/generate' : '/api/fal/generate';
      const count = mode === 'image' ? settings.numGenerations : 1;

      const generationIds: string[] = [];

      for (let i = 0; i < count; i++) {
        const body = mode === 'image'
          ? {
              model: settings.model,
              prompt: capturedPrompt,
              aspectRatio: settings.aspectRatio,
              resolution: settings.resolution,
              numImages: 1,
              referenceImageUrls: capturedRefImages,
              sourceType: 'chat',
              sourceId: sessionId,
            }
          : {
              model: settings.model,
              prompt: capturedPrompt,
              aspectRatio: settings.aspectRatio,
              duration: settings.duration ?? 5,
              startFrameUrl: capturedRefImages[0] ?? undefined,
              endFrameUrl: capturedRefImages[1] ?? undefined,
              sourceType: 'chat',
              sourceId: sessionId,
            };

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const result = await res.json() as {
          generationId?: string;
          requestId?: string;
          endpoint?: string;
          status?: string;
          requests?: Array<{ requestId: string; generationId?: string; endpoint: string }>;
        };

        if (result.generationId) {
          generationIds.push(result.generationId);

          // Load the saved generation from DB
          const { data: gen } = await supabase
            .from('generations')
            .select('*')
            .eq('id', result.generationId)
            .single();
          if (gen) {
            addGeneration(gen as Generation);
            addToGallery(gen as Generation);

            // Set session thumbnail from the first generated image
            const currentSession = sessions.find(s => s.id === sessionId);
            if (!currentSession?.thumbnail_url && gen.media_url) {
              await supabase.from('chat_sessions').update({ thumbnail_url: gen.media_url }).eq('id', sessionId!);
              updateSession(sessionId!, { thumbnail_url: gen.media_url });
            }
          }
        }

        const pendingRequest = result.requests?.[0];
        const requestId = pendingRequest?.requestId ?? result.requestId;
        const requestEndpoint = pendingRequest?.endpoint ?? result.endpoint;

        // Handle queued image and video generation
        if (requestId && result.status === 'pending') {
          // Poll
          let attempts = 0;
          const pollInterval = setInterval(async () => {
            attempts++;
            if (attempts > 100) { clearInterval(pollInterval); return; }
            const query = new URLSearchParams();
            if (requestEndpoint) query.set('endpoint', requestEndpoint);
            if (mode === 'image') query.set('mediaType', 'image');
            const statusRes = await fetch(`/api/fal/status/${requestId}?${query.toString()}`);
            const status = await statusRes.json();
            if (status.status === 'completed' && status.generationId) {
              clearInterval(pollInterval);
              const { data: gen } = await supabase
                .from('generations')
                .select('*')
                .eq('id', status.generationId)
                .single();
              if (gen) {
                if (!generationIds.includes(status.generationId)) {
                  generationIds.push(status.generationId);
                }
                addGeneration(gen as Generation);
                addToGallery(gen as Generation);
                updateGeneration(status.generationId, gen as Partial<Generation>);
              }
            }
          }, 3000);
        }
      }

      // Save system message with generation IDs
      if (generationIds.length > 0) {
        const { data: sysMsg } = await supabase
          .from('chat_messages')
          .insert({
            session_id: sessionId,
            user_id: user.id,
            role: 'system',
            content: null,
            generation_ids: generationIds,
          })
          .select()
          .single();
        if (sysMsg) addMessage(sessionId, sysMsg as ChatMessage);
      }
    } catch (err) {
      console.error('Generation failed:', err);
    } finally {
      setIsGenerating(false);
    }
  }

  const activeMessages = activeSessionId ? (messages[activeSessionId] ?? []) : [];
  const generationIds = new Set(activeMessages.flatMap(message => message.generation_ids ?? []));
  const activeGenerations = Object.values(generations)
    .filter(gen => gen.media_type !== 'prompt' && (generationIds.has(gen.id) || (activeSessionId && gen.source_type === 'chat' && gen.source_id === activeSessionId)))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <div className={styles.workspace}>
      <div className={styles.sessions}><SessionList onNewSession={createNewSession} /></div>
      <div ref={feedRef} className={styles.feed}>
        {toast && <div className={styles.toast} role="status">{toast}</div>}
        <div className={styles.scroll}>
          {activeGenerations.length > 0 ? (
            <GenerationGrid generations={activeGenerations} itemsPerRow={itemsPerRow} onSelect={setSelectedGen} onCopyPrompt={handleCopyPrompt} />
          ) : (
            <div className={styles.empty}><Images size={24} /><span>{isGenerating ? 'Generating...' : 'No generations yet'}</span></div>
          )}
        </div>
        <div ref={dockRef} className={styles.dock}><ChatInput onSubmit={handleGenerate} /></div>
      </div>
      {selectedGen && (
        <GenerationModal key={selectedGen.id} generation={selectedGen} onClose={() => setSelectedGen(null)} onDelete={handleDelete} />
      )}
    </div>
  );
}
