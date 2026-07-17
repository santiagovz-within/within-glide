// Shared media helpers — safe to import in both server and client modules.

const resolvedRefCache = new Map<string, string>();

function isFreshSignedUrl(url: string): boolean {
  const signedAtMatch = url.match(/[?&]X-Goog-Date=(\d{8}T\d{6}Z)/);
  const expiresMatch = url.match(/[?&]X-Goog-Expires=(\d+)/);
  if (!signedAtMatch || !expiresMatch) return true;

  const signedAt = signedAtMatch[1];
  const signedAtMs = Date.UTC(
    Number(signedAt.slice(0, 4)),
    Number(signedAt.slice(4, 6)) - 1,
    Number(signedAt.slice(6, 8)),
    Number(signedAt.slice(9, 11)),
    Number(signedAt.slice(11, 13)),
    Number(signedAt.slice(13, 15)),
  );
  const expiresAtMs = signedAtMs + Number(expiresMatch[1]) * 1000;
  return expiresAtMs > Date.now() + 5 * 60 * 1000;
}

/** Returns true when `url` is a GCS canonical reference (`gcs:<objectPath>`). */
export function isGcsRef(url: string | null | undefined): url is string {
  return typeof url === 'string' && url.startsWith('gcs:');
}

/** Strips the `gcs:` prefix to get the raw GCS object path. */
export function gcsPathFromRef(ref: string): string {
  return ref.slice(4);
}

/**
 * Returns true when `url` is an old stored signed GCS URL
 * (https://storage.googleapis.com/<bucket>/<path>?...X-Goog-Signature=...).
 * These were stored directly in the DB before canonical gcs: refs were adopted,
 * and they expire after 7 days.
 */
export function isSignedGcsUrl(url: string | null | undefined): url is string {
  return (
    typeof url === 'string' &&
    url.startsWith('https://storage.googleapis.com/') &&
    url.includes('X-Goog-Signature=')
  );
}

/**
 * Extracts the raw GCS object path from a stored signed URL.
 * Returns null if the URL doesn't match the expected pattern.
 */
export function extractGcsPathFromSignedUrl(url: string): string | null {
  // Pattern: https://storage.googleapis.com/<bucket>/<path>?<query>
  const withoutBase = url.slice('https://storage.googleapis.com/'.length);
  const slashIdx = withoutBase.indexOf('/');
  if (slashIdx === -1) return null;
  const pathWithQuery = withoutBase.slice(slashIdx + 1);
  const qIdx = pathWithQuery.indexOf('?');
  const encoded = qIdx === -1 ? pathWithQuery : pathWithQuery.slice(0, qIdx);
  return decodeURIComponent(encoded);
}

/**
 * Batch-resolves GCS refs and old stored signed URLs to fresh signed read URLs
 * via the `/api/media/sign` endpoint.
 * Non-GCS values pass through unchanged.
 * Returns a Map of original ref/url → resolved URL.
 */
export async function resolveGcsRefs(
  refs: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const uniqueSignable = [...new Set(
    refs.filter(r => isGcsRef(r) || isSignedGcsUrl(r)) as string[],
  )];
  const toSign = uniqueSignable.filter((ref) => {
    const cached = resolvedRefCache.get(ref);
    if (!cached || !isFreshSignedUrl(cached)) return true;
    result.set(ref, cached);
    return false;
  });

  if (toSign.length === 0) return result;

  const res = await fetch('/api/media/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths: toSign }),
  });
  if (!res.ok) return result;
  const { urls } = await res.json() as { urls: Record<string, string> };
  for (const [ref, url] of Object.entries(urls)) {
    resolvedRefCache.set(ref, url);
    result.set(ref, url);
  }
  return result;
}

/**
 * Resolves a single URL: if it's a GCS ref or an old stored signed URL,
 * fetches a fresh signed URL; otherwise returns it unchanged.
 */
export async function resolveMediaUrl(url: string): Promise<string> {
  if (!isGcsRef(url) && !isSignedGcsUrl(url)) return url;
  const map = await resolveGcsRefs([url]);
  return map.get(url) ?? url;
}
