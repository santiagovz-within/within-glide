import { getSignedReadUrl, signGcsRef, isGcsRef } from '@/lib/gcs';

const BUCKET = process.env.GCS_BUCKET_NAME ?? 'within-glide';
const SIGNED_URL_RE = new RegExp(
  `^https://storage\\.googleapis\\.com/${BUCKET}/([^?]+)\\?`,
);

function extractPath(url: string): string | null {
  const m = url.match(SIGNED_URL_RE);
  return m ? decodeURIComponent(m[1]) : null;
}

function needsResigning(url: string): boolean {
  const dateMatch = url.match(/[?&]X-Goog-Date=(\d{8}T\d{6}Z)/);
  const expiresMatch = url.match(/[?&]X-Goog-Expires=(\d+)/);
  if (!dateMatch || !expiresMatch) return true;
  const s = dateMatch[1];
  const signedAt = Date.UTC(
    +s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8),
    +s.slice(9, 11), +s.slice(11, 13), +s.slice(13, 15),
  );
  const expiryMs = signedAt + parseInt(expiresMatch[1]) * 1000;
  return expiryMs < Date.now() + 24 * 60 * 60 * 1000;
}

export async function signFlowMediaUrl(value: string): Promise<string> {
  if (isGcsRef(value)) return signGcsRef(value);
  const path = extractPath(value);
  if (path && needsResigning(value)) return getSignedReadUrl(path);
  return value;
}

export async function signFlowMedia(value: unknown): Promise<unknown> {
  if (typeof value === 'string') return signFlowMediaUrl(value);
  if (Array.isArray(value)) return Promise.all(value.map(signFlowMedia));
  if (value !== null && typeof value === 'object') {
    const entries = await Promise.all(
      Object.entries(value as Record<string, unknown>).map(async ([k, v]) => [k, await signFlowMedia(v)]),
    );
    return Object.fromEntries(entries);
  }
  return value;
}

