import { create } from 'zustand';
import type { Generation } from '@/types';

type GalleryFilter = 'all' | 'image' | 'video';
type GallerySort = 'newest' | 'oldest';

interface GalleryStore {
  generations: Generation[];
  setGenerations: (generations: Generation[]) => void;
  addGeneration: (generation: Generation) => void;
  removeGeneration: (id: string) => void;

  filter: GalleryFilter;
  setFilter: (filter: GalleryFilter) => void;

  sort: GallerySort;
  setSort: (sort: GallerySort) => void;

  selectedId: string | null;
  setSelectedId: (id: string | null) => void;

  isLoading: boolean;
  setIsLoading: (v: boolean) => void;

  filteredGenerations: () => Generation[];
}

export const useGalleryStore = create<GalleryStore>((set, get) => ({
  generations: [],
  setGenerations: (generations) => set({ generations }),
  addGeneration: (generation) =>
    set({ generations: [generation, ...get().generations] }),
  removeGeneration: (id) =>
    set({ generations: get().generations.filter((g) => g.id !== id) }),

  filter: 'all',
  setFilter: (filter) => set({ filter }),

  sort: 'newest',
  setSort: (sort) => set({ sort }),

  selectedId: null,
  setSelectedId: (id) => set({ selectedId: id }),

  isLoading: false,
  setIsLoading: (v) => set({ isLoading: v }),

  filteredGenerations: () => {
    const { generations, filter, sort } = get();
    let filtered = [...generations];

    if (filter !== 'all') {
      filtered = filtered.filter((g) => g.media_type === filter);
    }

    filtered.sort((a, b) => {
      const aTime = new Date(a.created_at).getTime();
      const bTime = new Date(b.created_at).getTime();
      return sort === 'newest' ? bTime - aTime : aTime - bTime;
    });

    return filtered;
  },
}));
