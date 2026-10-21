import { Storage } from '@google-cloud/storage';
import { isSignedGcsUrl, extractGcsPathFromSignedUrl } from '@/lib/utils/mediaUtils';

// Server-only module — never import from client components.

const BUCKET_NAME = process.env.GCS_BUCKET_NAME ?? 'within-glide';
// IAM-managed signing keys are guaranteed for only 12 hours. A longer URL
// expiration can otherwise appear valid in the client after its key rotates.
const READ_TTL_MS = (process.env.GCS_CREDENTIALS_JSON ? 7 * 24 : 12) * 60 * 60 * 1000;
const UPLOAD_TTL_MS = 15 * 60 * 1000;           // 15 minutes
const SIGNING_WINDOW_MS = (process.env.GCS_CREDENTIALS_JSON ? 24 : 6) * 60 * 60 * 1000;
const signedReads = new Map<string, Promise<string>>();
let signingWindow = 0;

/**
 * Objects and their signed responses remain private. The Vercel optimizer was
 * verified to turn this exact upstream policy into a shared transformed cache
 * entry, while direct original responses stay in private browser caches.
 */
export const MEDIA_CACHE_CONTROL = 'private, max-age=604800, immutable';

let _storage: Storage | null = null;

function getStorage(): Storage {
  if (!_storage) {
    const raw = process.env.GCS_CREDENTIALS_JSON;
    // Cloud Run uses its attached service identity (including IAM signBlob).
    // Existing Vercel/local environments can continue using their JSON key.
    if (!raw) {
      _storage = new Storage();
      return _storage;
    }
    const credentials = JSON.parse(raw);
    // GCS service-account JSON stores the private key with literal \n sequences
    // when set via environment variables; unescape them so the SDK can sign URLs.
    if (credentials.private_key) {
      credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    }
    _storage = new Storage({ credentials });
  }
  return _storage;
}

export function getGcsBucket() {
  return getStorage().bucket(BUCKET_NAME);
}

// ── Writes ────────────────────────────────────────────────────────────────────

/**
 * Uploads a buffer to GCS and returns the canonical ref string `gcs:<objectPath>`
 * that should be stored in the Supabase database.
 */
export async function uploadToGCS(
  buffer: Buffer | ArrayBuffer,
  objectPath: string,
  contentType: string,
  options: { cacheControl?: string } = {},
): Promise<string> {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const file = getGcsBucket().file(objectPath);
  await file.save(buf, {
    metadata: {
      contentType,
      ...(options.cacheControl ? { cacheControl: options.cacheControl } : {}),
    },
    resumable: false,
  });
  return `gcs:${objectPath}`;
}

// ── Signed read URL ───────────────────────────────────────────────────────────

/**
 * Returns a cached signed read URL: 6–12 hours with IAM signing, or 6–7 days
 * when using an explicitly configured service-account key.
 * `objectPath` must NOT include the `gcs:` prefix.
 */
export async function getSignedReadUrl(objectPath: string): Promise<string> {
  // Share signatures across requests and coalesce concurrent IAM signing calls.
  // Fixed windows keep URLs reusable while leaving a useful validity period,
  // including at the boundary. IAM URLs expire before managed-key rotation.
  const accessibleAtMs = Math.floor(Date.now() / SIGNING_WINDOW_MS) * SIGNING_WINDOW_MS;
  if (signingWindow !== accessibleAtMs) {
    signedReads.clear();
    signingWindow = accessibleAtMs;
  }
  const existing = signedReads.get(objectPath);
  if (existing) return existing;
  if (signedReads.size >= 5_000) signedReads.delete(signedReads.keys().next().value!);
  const pending = getGcsBucket()
    .file(objectPath)
    .getSignedUrl({
      action: 'read',
      version: 'v4',
      accessibleAt: new Date(accessibleAtMs),
      expires: new Date(accessibleAtMs + READ_TTL_MS - 1000),
    }).then(([url]) => url).catch((error) => {
      if (signedReads.get(objectPath) === pending) signedReads.delete(objectPath);
      throw error;
    });
  signedReads.set(objectPath, pending);
  return pending;
}

/** A rolling signed URL for short-lived server-to-server work. */
export async function getFreshSignedReadUrl(objectPath: string): Promise<string> {
  const [url] = await getGcsBucket().file(objectPath).getSignedUrl({
    action: 'read',
    version: 'v4',
    expires: Date.now() + READ_TTL_MS,
  });
  return url;
}

/**
 * Returns a signed read URL for a `gcs:<path>` reference string.
 * Convenience wrapper used by API routes.
 */
export async function signGcsRef(ref: string): Promise<string> {
  return getSignedReadUrl(gcsPathFromRef(ref));
}

/**
 * Signs a stored thumbnail value for direct client use: canonical `gcs:` refs
 * and legacy stored signed URLs get a fresh epoch-pinned signed URL, other
 * values pass through unchanged. Returns null when signing fails so a single
 * bad value degrades to a missing thumbnail instead of failing the caller.
 */
export async function signStoredThumbnail(stored: string | null): Promise<string | null> {
  if (!stored) return null;
  try {
    if (isGcsRef(stored)) return await signGcsRef(stored);
    if (isSignedGcsUrl(stored)) {
      const path = extractGcsPathFromSignedUrl(stored);
      return path ? await getSignedReadUrl(path) : null;
    }
    return stored;
  } catch {
    return null;
  }
}

// ── Signed upload URL ─────────────────────────────────────────────────────────

/**
 * Returns a signed upload URL for direct browser-to-GCS PUT uploads.
 * Valid for 15 minutes.
 *
 * IMPORTANT: The GCS bucket must have CORS configured to allow PUT requests
 * from the app's origin. Example cors.json:
 *
 *   [{ "origin": ["*"], "method": ["PUT","GET","HEAD"],
 *      "responseHeader": ["Content-Type"], "maxAgeSeconds": 3600 }]
 *
 * Apply with: gsutil cors set cors.json gs://within-glide
 */
export async function getSignedUploadUrl(
  objectPath: string,
  contentType: string,
  cacheControl?: string,
): Promise<string> {
  const [url] = await getGcsBucket()
    .file(objectPath)
    .getSignedUrl({
      action: 'write',
      version: 'v4',
      contentType,
      expires: Date.now() + UPLOAD_TTL_MS,
      ...(cacheControl
        ? { extensionHeaders: { 'cache-control': cacheControl } }
        : {}),
    });
  return url;
}

// ── Deletion ──────────────────────────────────────────────────────────────────

/** Deletes an object from GCS. Silently ignores 404s. */
export async function deleteFromGCS(objectPath: string): Promise<void> {
  await getGcsBucket()
    .file(objectPath)
    .delete({ ignoreNotFound: true });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns true if the value is a GCS canonical ref (`gcs:<path>`). */
export function isGcsRef(url: string | null | undefined): url is string {
  return typeof url === 'string' && url.startsWith('gcs:');
}

/** Strips the `gcs:` prefix to get the raw GCS object path. */
export function gcsPathFromRef(ref: string): string {
  return ref.slice(4);
}
