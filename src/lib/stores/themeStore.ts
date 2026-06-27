import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Theme } from '@/types';

interface ThemeStore {
  theme: Theme;
  soundEnabled: boolean;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  toggleSound: () => void;
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      soundEnabled: true,
      setTheme: (theme) => {
        set({ theme });
        if (typeof document !== 'undefined') {
          document.documentElement.setAttribute('data-theme', theme);
        }
      },
      toggleTheme: () => {
        const next = get().theme === 'dark' ? 'light' : 'dark';
        set({ theme: next });
        if (typeof document !== 'undefined') {
          document.documentElement.setAttribute('data-theme', next);
        }
      },
      toggleSound: () => set((s) => ({ soundEnabled: !s.soundEnabled })),
    }),
    {
      name: 'flowcanvas-theme',
      onRehydrateStorage: () => (state) => {
        if (state && typeof document !== 'undefined') {
          document.documentElement.setAttribute('data-theme', state.theme);
        }
      },
    }
  )
);
