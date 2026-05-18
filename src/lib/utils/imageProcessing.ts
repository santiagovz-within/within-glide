import imageCompression from 'browser-image-compression';

// --- Thresholds ---
const COMPRESSION_THRESHOLD = 15 * 1024 * 1024; // compress if > 15 MB
const HARD_LIMIT = 20 * 1024 * 1024;            // never upload > 20 MB

// Accepted MIME types (must match the server's allowedTypes in /api/upload)
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type AcceptedMime = (typeof ACCEPTED_TYPES)[number];

// First bytes that must be present for each MIME type
const MAGIC: Record<AcceptedMime, number[]> = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png':  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/webp': [0x52, 0x49, 0x46, 0x46], // RIFF — bytes 8-11 checked separately
};
// Additional WebP signature at offset 8
const WEBP_TAIL = [0x57, 0x45, 0x42, 0x50]; // "WEBP"

export type ProcessStage = 'validating' | 'compressing' | 'uploading';
export type ProgressCallback = (stage: ProcessStage, percent?: number) => void;

// --- Validation ---

async function validateImage(file: File): Promise<void> {
  // 1. MIME type must be one of our accepted types
  if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    const label = file.type || 'unknown';
    throw new Error(
      `Unsupported file type "${label}". Please upload a JPEG, PNG, or WebP image.`,
    );
  }

  // 2. Magic-number header check — confirms file content matches declared type
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const magic = MAGIC[file.type as AcceptedMime];
  if (!magic.every((b, i) => header[i] === b)) {
    throw new Error(
      'File header does not match the declared image type. The file may be corrupt or misnamed.',
    );
  }
  if (file.type === 'image/webp' && !WEBP_TAIL.every((b, i) => header[8 + i] === b)) {
    throw new Error(
      'File header does not match the declared image type. The file may be corrupt or misnamed.',
    );
  }

  // 3. Full decodability — createImageBitmap throws on corrupt / truncated files
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(
      'Image could not be decoded. The file may be corrupt or incomplete.',
    );
  }
  const { width, height } = bitmap;
  bitmap.close();
  if (width === 0 || height === 0) {
    throw new Error('Image has zero dimensions and cannot be used.');
  }
}

// --- Main pipeline ---

/**
 * Validates an image file (MIME type, magic header, decodability) and compresses
 * it if it is larger than 15 MB. The hard upload limit is 20 MB.
 *
 * Uploads go browser-to-Supabase directly (see uploadImage.ts), so these limits
 * are Supabase's limits — not Vercel's 4.5 MB function payload limit.
 *
 * `onProgress` receives stage changes and, during compression, 0-100 percent.
 * Returns the file that should be uploaded — either the original or the compressed version.
 */
export async function processImageFile(
  file: File,
  onProgress: ProgressCallback,
): Promise<File> {
  // --- Validate ---
  onProgress('validating');
  await validateImage(file);

  // Small files: skip compression entirely
  if (file.size <= COMPRESSION_THRESHOLD) {
    return file;
  }

  // --- Compress: first pass, target 14 MB ---
  onProgress('compressing', 0);

  let result: File;
  try {
    result = await imageCompression(file, {
      maxSizeMB: 14,
      maxWidthOrHeight: 8192,
      useWebWorker: true,
      maxIteration: 15,
      onProgress: (p) => onProgress('compressing', p),
    });
  } catch (err) {
    throw new Error(
      `Compression failed: ${err instanceof Error ? err.message : 'unknown error'}.`,
    );
  }

  // --- Compress: second pass if first pass couldn't get under the hard limit ---
  if (result.size > HARD_LIMIT) {
    onProgress('compressing', 0);
    try {
      result = await imageCompression(file, {
        maxSizeMB: 19,
        maxWidthOrHeight: 2048,
        initialQuality: 0.5,
        useWebWorker: true,
        maxIteration: 20,
        onProgress: (p) => onProgress('compressing', p),
      });
    } catch (err) {
      throw new Error(
        `Compression failed: ${err instanceof Error ? err.message : 'unknown error'}.`,
      );
    }
  }

  if (result.size > HARD_LIMIT) {
    throw new Error(
      'Image is too large even after compression. Please use a smaller source image.',
    );
  }

  return result;
}
