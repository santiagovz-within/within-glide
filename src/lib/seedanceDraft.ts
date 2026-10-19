import type { VideoGenerationMetadata } from '@/types';

export const SEEDANCE_DRAFT_COMPLETE_ENDPOINT = 'bytedance/seedance-2.5/draft/complete';
export const SEEDANCE_DRAFT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const DRAFT_ENDPOINTS = [
  'bytedance/seedance-2.5/text-to-video',
  'bytedance/seedance-2.5/image-to-video',
  'bytedance/seedance-2.5/reference-to-video',
];

/** Validate before submission: a plain 480p generation is not a completable draft. */
export function validateSeedanceDraft(model: string, draft: unknown): boolean {
  if (draft !== undefined && typeof draft !== 'boolean') throw new Error('Draft mode must be a boolean.');
  if (draft === true && model !== 'seedance-2-5') throw new Error('Draft mode is only available for Seedance 2.5.');
  return draft === true;
}

export function saveVideoResultParameters(
  parameters: Record<string, unknown>, result: { draft_id?: unknown; seed?: unknown }, createdAt: string,
): Record<string, unknown> {
  const isDraft = parameters.draft === true && DRAFT_ENDPOINTS.includes(String(parameters.endpoint));
  return {
    ...parameters,
    ...(typeof result.seed === 'number' ? { seed: result.seed } : {}),
    ...(isDraft && typeof result.draft_id === 'string' && result.draft_id ? {
      draftId: result.draft_id,
      // Use submission time conservatively; refreshing a result never extends its lifetime.
      draftExpiresAt: new Date(Date.parse(createdAt) + SEEDANCE_DRAFT_LIFETIME_MS).toISOString(),
    } : {}),
  };
}

export function videoGenerationMetadata(generation: {
  id: string; parameters?: Record<string, unknown> | null; created_at?: string;
}): VideoGenerationMetadata {
  const p = generation.parameters ?? {};
  const duration = Number(p.duration);
  return {
    generationId: generation.id,
    endpoint: typeof p.endpoint === 'string' ? p.endpoint : undefined,
    resolution: typeof p.resolution === 'string' ? p.resolution : undefined,
    seed: typeof p.seed === 'number' ? p.seed : undefined,
    createdAt: generation.created_at,
    isDraft: p.draft === true && DRAFT_ENDPOINTS.includes(String(p.endpoint)),
    draftId: typeof p.draftId === 'string' ? p.draftId : undefined,
    draftExpiresAt: typeof p.draftExpiresAt === 'string' ? p.draftExpiresAt : undefined,
    sourceDraftGenerationId: typeof p.sourceDraftGenerationId === 'string' ? p.sourceDraftGenerationId : undefined,
    aspectRatio: typeof p.aspectRatio === 'string' ? p.aspectRatio : undefined,
    duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
    referenceVideoUrls: Array.isArray(p.referenceVideoUrls)
      ? p.referenceVideoUrls.filter((url): url is string => typeof url === 'string') : [],
  };
}

export function canCompleteSeedanceDraft(metadata: VideoGenerationMetadata | null | undefined, now = Date.now()): boolean {
  return !!metadata?.isDraft && !!metadata.draftId && !!metadata.draftExpiresAt
    && Date.parse(metadata.draftExpiresAt) > now;
}

/** Keep legacy URL history and per-result metadata aligned, including after recovery. */
export function appendVideoResult(
  history: string[], metadata: Array<VideoGenerationMetadata | null> | undefined,
  url: string, result?: VideoGenerationMetadata,
) {
  const entries = history.map((_, index) => metadata?.[index] ?? null);
  const existing = result ? entries.findIndex(entry => entry?.generationId === result.generationId) : -1;
  if (existing >= 0) {
    return {
      videoHistory: history.map((value, index) => index === existing ? url : value),
      videoHistoryMetadata: entries.map((entry, index) => index === existing ? result! : entry),
    };
  }
  return { videoHistory: [...history, url], videoHistoryMetadata: [...entries, result ?? null] };
}
