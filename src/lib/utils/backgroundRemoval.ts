import imageCompression from 'browser-image-compression';
import { isGcsRef, resolveMediaUrl } from './mediaUtils';
import { uploadImageToStorage } from './uploadImage';

// https://fal.ai/models/fal-ai/ideogram/remove-background/api
export const BACKGROUND_REMOVAL_MAX_BYTES = 10 * 1024 * 1024;
const SUPPORTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** Prepare a separate provider input; never replace the connected source image. */
export async function prepareBackgroundRemovalImage(source: string): Promise<string> {
  const url = await resolveMediaUrl(source);
  if (isGcsRef(url)) throw new Error('Could not load the source image. Reopen the flow and try again.');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load the source image (${response.status}). Reopen the flow and try again.`);
  const image = await response.blob();
  const contentType = image.type.split(';')[0].toLowerCase();
  if (!SUPPORTED_TYPES.includes(contentType)) {
    throw new Error('Background removal supports JPEG, PNG and WebP images. Convert this image to one of those formats first.');
  }
  if (image.size === 0) throw new Error('The source image is empty.');
  if (image.size <= BACKGROUND_REMOVAL_MAX_BYTES) return url;

  // Quality compression first, without imposing the normal upload pipeline's
  // 2048px resize. WebP retains alpha; a safety margin avoids provider rejection.
  const compressed = await imageCompression(new File([image], 'background-removal-source', { type: contentType }), {
    maxSizeMB: 9.5,
    fileType: 'image/webp',
    initialQuality: 0.95,
    alwaysKeepResolution: true,
    useWebWorker: true,
  });
  if (!compressed.size || compressed.size > BACKGROUND_REMOVAL_MAX_BYTES) {
    throw new Error('This image is still over the 10 MB background-removal limit after compression. Use a smaller image.');
  }
  return uploadImageToStorage(new File([compressed], 'background-removal-source.webp', { type: 'image/webp' }));
}
