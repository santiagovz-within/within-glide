import { create } from 'zustand';
import { MUSIC_MODELS, getMusicModel, musicLengthOptions } from '@/lib/api/music';
import type { ChatSession, Generation } from '@/types';

export interface AudioSettings {
  model: string;
  duration: number;
  numSounds: number;
  outputFormat: string;
}

interface AudioStore {
  sessions: ChatSession[];
  activeSessionId: string | null;
  generations: Record<string, Generation>;
  prompt: string;
  settings: AudioSettings;
  isSubmitting: boolean;
  error: string;
  setSessions: (sessions: ChatSession[]) => void;
  addSession: (session: ChatSession) => void;
  updateSession: (id: string, updates: Partial<ChatSession>) => void;
  removeSession: (id: string) => void;
  setActiveSessionId: (id: string | null) => void;
  mergeGenerations: (generations: Generation[]) => void;
  removeGeneration: (id: string) => void;
  setPrompt: (prompt: string) => void;
  updateSettings: (settings: Partial<AudioSettings>) => void;
  setModel: (modelId: string) => void;
}

const defaultModel = MUSIC_MODELS[0];

export const useAudioStore = create<AudioStore>((set) => ({
  sessions: [], activeSessionId: null, generations: {}, prompt: '', isSubmitting: false, error: '',
  settings: { model: defaultModel.id, duration: defaultModel.defaultDuration, numSounds: 1, outputFormat: defaultModel.defaultFormat },
  setSessions: sessions => set(state => ({ sessions,
    activeSessionId: sessions.some(session => session.id === state.activeSessionId) ? state.activeSessionId : sessions[0]?.id ?? null })),
  addSession: session => set(state => ({ sessions: [session, ...state.sessions], activeSessionId: session.id })),
  updateSession: (id, updates) => set(state => ({
    sessions: state.sessions.map(session => session.id === id ? { ...session, ...updates } : session)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
  })),
  removeSession: id => set(state => ({ sessions: state.sessions.filter(session => session.id !== id) })),
  setActiveSessionId: activeSessionId => set({ activeSessionId }),
  mergeGenerations: generations => set(state => {
    const next = { ...state.generations };
    for (const generation of generations) {
      // A slower load must not replace a result just completed by the poller.
      const previous = next[generation.id];
      if (previous && !isAudioPending(previous) && isAudioPending(generation)) continue;
      next[generation.id] = generation;
    }
    return { generations: next };
  }),
  removeGeneration: id => set(state => ({ generations: Object.fromEntries(Object.entries(state.generations).filter(([key]) => key !== id)) })),
  setPrompt: prompt => set({ prompt }),
  updateSettings: updates => set(state => ({ settings: { ...state.settings, ...updates } })),
  setModel: modelId => set(state => {
    const model = getMusicModel(modelId);
    if (!model) return state;
    return { settings: { model: model.id,
      duration: musicLengthOptions(model.id).includes(state.settings.duration) ? state.settings.duration : model.defaultDuration,
      numSounds: Math.min(state.settings.numSounds, model.maxBatchSize), outputFormat: model.defaultFormat } };
  }),
}));

export function isAudioPending(generation: Generation) {
  return generation.status === 'pending' || generation.status === 'processing';
}
