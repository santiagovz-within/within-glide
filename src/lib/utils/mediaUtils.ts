// Shared media helpers — safe to import in both server and client modules.

/** Returns true when `url` is a GCS canonical reference (`gcs:<objectPath>`). */
export function isGcsRef(url: string | null | undefined): url is string {
  return typeof url === 'string' && url.startsWith('gcs:');
}

/** Strips the `gcs:` prefix to get the raw GCS object path. */
export function gcsPathFromRef(ref: string): string {
  return ref.slice(4);
}

/**
 * Batch-resolves GCS refs to signed read URLs via the `/api/media/sign` endpoint.
 * Non-GCS URLs pass through unchanged.
 * Returns a Map of original ref → resolved URL.
 */
export async function resolveGcsRefs(
  refs: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const gcsPaths = refs.filter(isGcsRef) as string[];
  if (gcsPaths.length === 0) return new Map();

  const res = await fetch('/api/media/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths: gcsPaths }),
  });
  if (!res.ok) return new Map();
  const { urls } = await res.json() as { urls: Record<string, string> };
  return new Map(Object.entries(urls));
}

/**
 * Resolves a single URL: if it's a GCS ref, fetches a signed URL;
 * otherwise returns it unchanged.
 */
export async function resolveMediaUrl(url: string): Promise<string> {
  if (!isGcsRef(url)) return url;
  const map = await resolveGcsRefs([url]);
  return map.get(url) ?? url;
}
