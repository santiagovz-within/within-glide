import { createClient } from '@/lib/supabase/client';
import { useAudioStore, type AudioSettings } from '@/lib/stores/audioStore';
import { useGalleryStore } from '@/lib/stores/galleryStore';
import { buildMusicInput } from '@/lib/api/music';
import type { ChatSession, Generation } from '@/types';

export const NEW_RECORDING_SESSION = 'New recording session';

export async function loadRecordingSessions(): Promise<ChatSession[]> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in to view recording sessions.');
  const { data, error } = await supabase.from('chat_sessions').select('*')
    .eq('user_id', user.id).eq('kind', 'audio').order('updated_at', { ascending: false });
  if (error) throw new Error('Could not load recording sessions. Please try again.');
  return (data ?? []) as ChatSession[];
}

export async function createRecordingSession(): Promise<ChatSession> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in to create a recording session.');
  const { data, error } = await supabase.from('chat_sessions')
    .insert({ user_id: user.id, title: NEW_RECORDING_SESSION, kind: 'audio' }).select().single();
  if (error || !data) throw new Error('Could not create a recording session. Please try again.');
  useAudioStore.getState().addSession(data as ChatSession);
  return data as ChatSession;
}

export async function loadRecordingGenerations(sessionId: string) {
  const { data, error } = await createClient().from('generations').select('*')
    .eq('source_type', 'chat').eq('source_id', sessionId).eq('media_type', 'audio')
    .order('created_at', { ascending: false });
  if (error) throw new Error('Could not load recordings. Please try again.');
  useAudioStore.getState().mergeGenerations((data ?? []) as Generation[]);
}

/** The source session is captured once so switching sessions cannot move a batch. */
export async function generateRecordingBatch() {
  const state = useAudioStore.getState();
  if (state.isSubmitting || !state.prompt.trim()) return;
  const prompt = state.prompt.trim();
  const settings: AudioSettings = { ...state.settings };
  let sessionId = state.activeSessionId;
  useAudioStore.setState({ isSubmitting: true, error: '' });
  try {
    buildMusicInput({ ...settings, prompt, generationSlotCount: settings.numSounds, slotIndex: 0 });
    if (!sessionId) sessionId = (await createRecordingSession()).id;
    const supabase = createClient();
    const session = useAudioStore.getState().sessions.find(item => item.id === sessionId);
    const updates = { updated_at: new Date().toISOString(),
      ...(session?.title === NEW_RECORDING_SESSION ? { title: prompt.slice(0, 60) } : {}) };
    const { error } = await supabase.from('chat_sessions').update(updates).eq('id', sessionId);
    if (error) throw new Error('Could not save the recording session. Please try again.');
    useAudioStore.getState().updateSession(sessionId, updates);
    const generationRunId = crypto.randomUUID();
    const errors: string[] = [];
    for (let slotIndex = 0; slotIndex < settings.numSounds; slotIndex++) {
      try {
        const response = await fetch('/api/fal/music', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...settings, prompt, sourceType: 'chat', sourceId: sessionId,
            generationRunId, generationSlotCount: settings.numSounds, slotIndex }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.details || result.error || 'Could not generate audio.');
        if (!result.requests?.[0]?.generationId) throw new Error('The music service did not return a generation.');
      } catch (error) {
        errors.push(`Track ${slotIndex + 1}: ${error instanceof Error ? error.message : 'Could not submit audio.'}`);
      }
      // Source-based history also recovers records after a lost submission response.
      await loadRecordingGenerations(sessionId);
    }
    if (errors.length) useAudioStore.setState({ error: errors.join(' ') });
  } catch (error) {
    useAudioStore.setState({ error: error instanceof Error ? error.message : 'Could not generate audio.' });
  } finally {
    useAudioStore.setState({ isSubmitting: false });
  }
}

/** Recovery queries only chat audio; canvas music remains owned by its canvas tracker. */
export async function recoverAudioGenerations() {
  const { data, error } = await createClient().from('generations').select('*')
    .eq('source_type', 'chat').eq('media_type', 'audio').in('status', ['pending', 'processing']);
  if (error) throw new Error('Could not check pending audio.');
  useAudioStore.getState().mergeGenerations((data ?? []) as Generation[]);
}

const polling = new Set<string>();
export async function pollAudioGeneration(generation: Generation) {
  const requestId = generation.fal_request_id;
  if (!requestId || polling.has(requestId)) return;
  polling.add(requestId);
  try {
    const response = await fetch(`/api/fal/status/${encodeURIComponent(requestId)}?mediaType=audio`, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) return; // Temporary service errors must not mark paid work as failed.
    const result = await response.json();
    if (result.status !== 'completed' && result.status !== 'failed') return;
    const { data, error } = await createClient().from('generations').select('*').eq('id', generation.id).single();
    if (error || !data) return;
    useAudioStore.getState().mergeGenerations([data as Generation]);
    if (data.status === 'completed') {
      const gallery = useGalleryStore.getState();
      gallery.setGenerations([data as Generation, ...gallery.generations.filter(item => item.id !== data.id)]);
    }
  } finally {
    polling.delete(requestId);
  }
}
