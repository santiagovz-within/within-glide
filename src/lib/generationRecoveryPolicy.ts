// This bounds recovery of unverified historical requests, not fal execution.
export const GENERATION_RECOVERY_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function isHistoricalGeneration(startedAt: number, now = Date.now()): boolean {
  return Number.isFinite(startedAt) && now - startedAt >= GENERATION_RECOVERY_AGE_MS;
}
