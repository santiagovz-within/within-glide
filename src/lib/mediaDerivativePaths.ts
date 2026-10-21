import { createHash } from 'node:crypto';

export const MEDIA_DERIVATIVE_PREFIX = 'media-derivatives/v1';
export const MEDIA_VARIANT_WIDTHS = [512, 1024, 2048] as const;
export type MediaVariantWidth = typeof MEDIA_VARIANT_WIDTHS[number];

export type MediaKind = 'image' | 'video';

export interface MediaDerivativePaths {
  thumbnailPath: string;
  posterPath?: string;
  variantPaths: Record<MediaVariantWidth, string>;
  variantManifestPath: string;
}

export function mediaDerivativePaths(
  objectPath: string,
  kind: MediaKind,
): MediaDerivativePaths {
  const key = createHash('sha256').update(objectPath).digest('hex');
  return {
    thumbnailPath: `${MEDIA_DERIVATIVE_PREFIX}/thumbs/${key}.webp`,
    variantPaths: {
      512: `media-derivatives/v2/${kind}/${key}/512.webp`,
      1024: `media-derivatives/v2/${kind}/${key}/1024.webp`,
      2048: `media-derivatives/v2/${kind}/${key}/2048.webp`,
    },
    variantManifestPath: `media-derivatives/v2/${kind}/${key}/ready.json`,
    ...(kind === 'video'
      ? { posterPath: `${MEDIA_DERIVATIVE_PREFIX}/posters/${key}.webp` }
      : {}),
  };
}

export function shouldCreateMediaDerivatives(
  objectPath: string,
  contentType: string,
): boolean {
  if (!contentType.startsWith('image/') && !contentType.startsWith('video/')) {
    return false;
  }

  return ![
    'media-derivatives/',
    'thumbnails/',
    'resized-inputs/',
    'site-settings/',
    'prompts/',
    'cache-probes/',
  ].some(prefix => objectPath.startsWith(prefix));
}
