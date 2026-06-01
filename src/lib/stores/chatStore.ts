import { create } from 'zustand';
import type { ChatSession, ChatMessage, Generation, ChatMode, ChatSettings } from '@/types';
import { getDefaultImageModel, getDefaultVideoModel } from '@/lib/api/models';

interface ChatStore {
  sessions: ChatSession[];
  setSessions: (sessions: ChatSession[]) => void;
  addSession: (session: ChatSession) => void;
  updateSession: (id: string, updates: Partial<ChatSession>) => void;
  removeSession: (id: string) => void;

  activeSessionId: string | null;
  setActiveSessionId: (id: string | null) => void;

  messages: Record<string, ChatMessage[]>;
  setMessages: (sessionId: string, messages: ChatMessage[]) => void;
  addMessage: (sessionId: string, message: ChatMessage) => void;

  generations: Record<string, Generation>;
  addGeneration: (generation: Generation) => void;
  updateGeneration: (id: string, updates: Partial<Generation>) => void;

  // Input state
  mode: ChatMode;
  setMode: (mode: ChatMode) => void;
  prompt: string;
  setPrompt: (prompt: string) => void;
  referenceImages: string[];
  setReferenceImages: (urls: string[]) => void;
  addReferenceImage: (url: string) => void;
  removeReferenceImage: (url: string) => void;
  settings: ChatSettings;
  updateSettings: (updates: Partial<ChatSettings>) => void;

  isGenerating: boolean;
  setIsGenerating: (v: boolean) => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  sessions: [],
  setSessions: (sessions) => set({ sessions }),
  addSession: (session) => set({ sessions: [session, ...get().sessions] }),
  updateSession: (id, updates) =>
    set({
      sessions: get().sessions.map((s) =>
        s.id === id ? { ...s, ...updates } : s
      ),
    }),
  removeSession: (id) =>
    set({ sessions: get().sessions.filter((s) => s.id !== id) }),

  activeSessionId: null,
  setActiveSessionId: (id) => set({ activeSessionId: id }),

  messages: {},
  setMessages: (sessionId, messages) =>
    set({ messages: { ...get().messages, [sessionId]: messages } }),
  addMessage: (sessionId, message) => {
    const existing = get().messages[sessionId] ?? [];
    set({ messages: { ...get().messages, [sessionId]: [...existing, message] } });
  },

  generations: {},
  addGeneration: (generation) =>
    set({ generations: { ...get().generations, [generation.id]: generation } }),
  updateGeneration: (id, updates) =>
    set({
      generations: {
        ...get().generations,
        [id]: { ...get().generations[id], ...updates },
      },
    }),

  mode: 'image',
  setMode: (mode) => {
    const defaultModel = mode === 'image'
      ? getDefaultImageModel().id
      : getDefaultVideoModel().id;
    set({
      mode,
      settings: { ...get().settings, model: defaultModel },
      referenceImages: [],
    });
  },
  prompt: '',
  setPrompt: (prompt) => set({ prompt }),
  referenceImages: [],
  setReferenceImages: (urls) => set({ referenceImages: urls }),
  addReferenceImage: (url) =>
    set({ referenceImages: [...get().referenceImages, url] }),
  removeReferenceImage: (url) =>
    set({ referenceImages: get().referenceImages.filter((u) => u !== url) }),

  settings: {
    model: getDefaultImageModel().id,
    aspectRatio: '1:1',
    resolution: '1K',
    quality: 'medium',
    numGenerations: 1,
    duration: 5,
  },
  updateSettings: (updates) =>
    set({ settings: { ...get().settings, ...updates } }),

  isGenerating: false,
  setIsGenerating: (v) => set({ isGenerating: v }),
}));
