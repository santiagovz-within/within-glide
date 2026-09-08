import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface GenerationLikesStore {
  likedIds: string[];
  toggleLike: (id: string) => void;
}

export const useGenerationLikesStore = create<GenerationLikesStore>()(
  persist(
    (set) => ({
      likedIds: [],
      toggleLike: (id) => set(({ likedIds }) => ({
        likedIds: likedIds.includes(id) ? likedIds.filter(value => value !== id) : [...likedIds, id],
      })),
    }),
    { name: 'canvasflow-generation-likes', storage: createJSONStorage(() => localStorage) },
  ),
);
