import 'server-only';
import sharp from 'sharp';
import { getGcsBucket, MEDIA_CACHE_CONTROL, uploadToGCS } from '@/lib/gcs';
import { MEDIA_VARIANT_WIDTHS, type MediaDerivativePaths } from '@/lib/mediaDerivativePaths';

const readyCache = new Map<string, { ready: boolean; expires: number }>();

/** A manifest is published only after every variant is durably stored. */
export async function hasMediaVariants(paths: MediaDerivativePaths): Promise<boolean> {
  const cached = readyCache.get(paths.variantManifestPath);
  if (cached && cached.expires > Date.now()) return cached.ready;
  const [ready] = await getGcsBucket().file(paths.variantManifestPath).exists();
  if (readyCache.size >= 2_000) readyCache.delete(readyCache.keys().next().value!);
  readyCache.set(paths.variantManifestPath, {
    ready,
    expires: Date.now() + (ready ? 300_000 : 30_000),
  });
  return ready;
}

export async function createMediaVariants(input: Buffer, paths: MediaDerivativePaths) {
  if (await hasMediaVariants(paths)) return;
  // Serial encodes bound peak decoded-image memory. Existing files are reused
  // when a previous attempt was interrupted before publishing its manifest.
  for (const width of MEDIA_VARIANT_WIDTHS) {
    const [exists] = await getGcsBucket().file(paths.variantPaths[width]).exists();
    if (exists) continue;
    const variant = await sharp(input, { animated: false, limitInputPixels: 64_000_000 })
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer();
    await uploadToGCS(variant, paths.variantPaths[width], 'image/webp', {
      cacheControl: MEDIA_CACHE_CONTROL,
    });
  }
  await uploadToGCS(Buffer.from(JSON.stringify({ version: 2, widths: MEDIA_VARIANT_WIDTHS })),
    paths.variantManifestPath, 'application/json', { cacheControl: MEDIA_CACHE_CONTROL });
  readyCache.set(paths.variantManifestPath, { ready: true, expires: Date.now() + 300_000 });
}

// Keep preview work from monopolizing a web instance. Duplicate callers share
// one operation; the fleet can scale independently for interactive requests.
const inFlight = new Map<string, Promise<MediaDerivativePaths | null>>();
const waiting: Array<() => void> = [];
let active = 0;
export function withMediaProcessingSlot(
  key: string,
  work: () => Promise<MediaDerivativePaths | null>,
): Promise<MediaDerivativePaths | null> {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const pending = (async () => {
    if (active >= 2) await new Promise<void>(resolve => waiting.push(resolve));
    else active++;
    try {
      return await work();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  })().finally(() => { inFlight.delete(key); });
  inFlight.set(key, pending);
  return pending;
}
