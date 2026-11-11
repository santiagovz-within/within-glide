import { getGptImage25Size } from './gptImage25';

export type GptImageOutputFormat = 'png' | 'jpeg' | 'gif';
export const GPT_IMAGE_GIF_FRAMES = 9;
export const GPT_IMAGE_GIF_FRAME_MS = 200;

/** Upgrade saved nodes and new submissions; keep historical model records intact. */
export function currentImageModel(model: string): string {
  return model === 'gpt-image-2-5' ? 'gpt-image-2-6' : model;
}

export function getGptImage26Size(aspectRatio: string, resolution: string, format: GptImageOutputFormat) {
  // Still-image constraints are unchanged from 2.5.
  const stillSize = getGptImage25Size(aspectRatio, resolution);
  if (!stillSize || format !== 'gif') return stillSize;
  // GIF image_size is per frame. Nine frames must share the 8,294,400-pixel
  // budget. Fit to a 512px long edge with dimensions divisible by 16.
  const scale = 512 / Math.max(stillSize.width, stillSize.height);
  return {
    width: Math.round(stillSize.width * scale / 16) * 16,
    height: Math.round(stillSize.height * scale / 16) * 16,
  };
}

export function gptImage26Output(format: unknown = 'png') {
  if (format !== 'png' && format !== 'jpeg' && format !== 'gif') {
    throw new Error('GPT Image 2.6 output format must be PNG, JPG, or GIF.');
  }
  return {
    output_format: format,
    ...(format === 'gif' ? { frame_count: GPT_IMAGE_GIF_FRAMES, frame_duration_ms: GPT_IMAGE_GIF_FRAME_MS } : {}),
  };
}
