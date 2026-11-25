import type { GenerationPromptSnapshot, PromptTag } from '@/types';

export function snapshotGenerationPrompt(data: { prompt?: string; promptTags?: PromptTag[] }): GenerationPromptSnapshot {
  return { prompt: data.prompt ?? '', promptTags: (data.promptTags ?? []).map(tag => ({ ...tag })) };
}

export function readPromptSnapshot(value: unknown): GenerationPromptSnapshot | null {
  if (!value || typeof value !== 'object' || !('prompt' in value) || typeof value.prompt !== 'string') return null;
  const tags = 'promptTags' in value && Array.isArray(value.promptTags) ? value.promptTags : [];
  return snapshotGenerationPrompt({ prompt: value.prompt, promptTags: tags.filter((tag): tag is PromptTag =>
    !!tag && typeof tag.label === 'string' && Number.isInteger(tag.portIndex)
    && (tag.edgeId === undefined || typeof tag.edgeId === 'string')
    && (tag.sourceNodeId === undefined || typeof tag.sourceNodeId === 'string')) });
}

/** Legacy generations retain the submitted text even if editable chips were not saved. */
export function savedGenerationPrompt(generation: {
  prompt?: string | null; parameters?: Record<string, unknown> | null;
}): GenerationPromptSnapshot | null {
  return readPromptSnapshot(generation.parameters?.promptSnapshot)
    ?? (typeof generation.prompt === 'string' ? { prompt: generation.prompt, promptTags: [] } : null);
}

export function withPromptHistoryEntry(
  history: Array<GenerationPromptSnapshot | null> | undefined,
  length: number, index: number, snapshot: GenerationPromptSnapshot | null | undefined,
): Array<GenerationPromptSnapshot | null> {
  return Array.from({ length }, (_, i) => i === index
    ? snapshot ? snapshotGenerationPrompt(snapshot) : history?.[i] ?? null
    : history?.[i] ?? null);
}
