import type { ImageGenNodeData } from '@/types';

/** Persist the successful part of a batch once, including legacy failed batches. */
export function preserveImageBatch(history: string[][], images: string[]): string[][] {
  if (!images.length) return history;
  const last = history.at(-1);
  return last?.length === images.length && last.every((url, index) => url === images[index])
    ? history : [...history, images];
}

export function acknowledgeImageFailure(data: ImageGenNodeData): Partial<ImageGenNodeData> {
  const images = data.generationSlots
    ? data.generationSlots.filter((url): url is string => !!url)
    : data.generatedImages ?? [];
  return {
    generatedImages: images,
    generationHistory: preserveImageBatch(data.generationHistory ?? [], images),
    status: images.length ? 'completed' : 'idle',
    errorMessage: undefined,
    generationErrors: undefined,
    generationSlots: undefined,
  };
}
