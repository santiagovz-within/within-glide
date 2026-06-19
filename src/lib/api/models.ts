import type { ModelConfig } from '@/types';

// Google Gemini image generation model IDs — keyed by our internal model ID
export const GOOGLE_IMAGE_MODELS: Record<string, string> = {};

export const FAL_MODELS = {
  'nano-banana-2': {
    endpoint: 'fal-ai/nano-banana-2',
    editEndpoint: 'fal-ai/nano-banana-2/edit',
    usesAspectRatio: true,
    supportsResolution: true,
    editImageParam: 'image_urls',
    type: 'image' as const,
  },
  'nano-banana-pro': {
    endpoint: 'fal-ai/nano-banana-pro',
    editEndpoint: 'fal-ai/nano-banana-pro/edit',
    usesAspectRatio: true,
    supportsResolution: true,
    editImageParam: 'image_urls',
    type: 'image' as const,
  },
  'gpt-image-2': {
    endpoint: 'openai/gpt-image-2',
    editEndpoint: 'openai/gpt-image-2/edit',
    editImageParam: 'image_urls',
    hasOwnQuality: true,
    type: 'image' as const,
  },
  'flux-2-pro': {
    endpoint: 'fal-ai/flux-pro/v1.1-ultra',
    usesAspectRatio: true,
    type: 'image' as const,
  },
  'kling-3-pro': {
    endpoint: 'fal-ai/kling-video/v3/pro/text-to-video',
    imageToVideoEndpoint: 'fal-ai/kling-video/v3/4k/image-to-video',
    type: 'video' as const,
  },
  'seedance-2': {
    endpoint: 'bytedance/seedance-2.0/text-to-video',
    imageToVideoEndpoint: 'bytedance/seedance-2.0/image-to-video',
    type: 'video' as const,
  },
  'seedvr2': {
    endpoint: 'fal-ai/seedvr/upscale/image',
    scaleParam: 'upscale_factor',
    scaleOptions: [2, 4, 8, 10],
    type: 'upscale' as const,
  },
  'topaz': {
    endpoint: 'fal-ai/topaz/upscale/image',
    scaleParam: 'upscale_factor',
    scaleOptions: [2, 4],
    type: 'upscale' as const,
  },
  'ideogram-remove-bg': {
    endpoint: 'fal-ai/ideogram/remove-background',
    type: 'remove-bg' as const,
  },
} as const;

export const MODELS: Record<string, ModelConfig> = {
  'nano-banana-2': {
    id: 'nano-banana-2',
    name: 'Nano Banana 2',
    provider: 'fal',
    type: 'image',
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
    supportedResolutions: ['1K'],
    maxBatchSize: 1,
    supportsImageInput: true,
    supportsNegativePrompt: false,
    estimatedTimeSeconds: 8,
  },
  'nano-banana-pro': {
    id: 'nano-banana-pro',
    name: 'Nano Banana Pro',
    provider: 'fal',
    type: 'image',
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
    supportedResolutions: ['1K'],
    maxBatchSize: 1,
    supportsImageInput: true,
    supportsNegativePrompt: false,
    estimatedTimeSeconds: 12,
  },
  'gpt-image-2': {
    id: 'gpt-image-2',
    name: 'GPT Image 2',
    provider: 'fal',
    type: 'image',
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
    supportedResolutions: ['1K', '2K', '4K'],
    maxBatchSize: 1,
    supportsImageInput: true,
    supportsNegativePrompt: false,
    estimatedTimeSeconds: 15,
    maxReferenceImages: 16,
  },
  'flux-2-pro': {
    id: 'flux-2-pro',
    name: 'Flux 2 Pro',
    provider: 'fal',
    type: 'image',
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '4:5', '21:9'],
    supportedResolutions: ['1K', '2K', '4K'],
    maxBatchSize: 1,
    supportsImageInput: false,
    supportsNegativePrompt: false,
    estimatedTimeSeconds: 15,
  },
  'kling-3-pro': {
    id: 'kling-3-pro',
    name: 'Kling 3 Pro',
    provider: 'fal',
    type: 'video',
    supportedAspectRatios: ['1:1', '16:9', '9:16'],
    supportedResolutions: ['1K'],
    maxBatchSize: 1,
    supportsImageInput: true,
    supportsNegativePrompt: false,
    estimatedTimeSeconds: 120,
  },
  'seedance-2': {
    id: 'seedance-2',
    name: 'Seedance 2.0',
    provider: 'fal',
    type: 'video',
    supportedAspectRatios: ['1:1', '16:9', '9:16'],
    supportedResolutions: ['1K'],
    maxBatchSize: 1,
    supportsImageInput: true,
    supportsNegativePrompt: false,
    estimatedTimeSeconds: 90,
  },
  'seedvr2': {
    id: 'seedvr2',
    name: 'SeedVR2',
    provider: 'fal',
    type: 'upscale',
    supportedAspectRatios: [],
    supportedResolutions: ['2K', '4K'],
    maxBatchSize: 1,
    supportsImageInput: true,
    supportsNegativePrompt: false,
    estimatedTimeSeconds: 30,
  },
  'topaz': {
    id: 'topaz',
    name: 'Topaz',
    provider: 'fal',
    type: 'upscale',
    supportedAspectRatios: [],
    supportedResolutions: ['2K', '4K'],
    maxBatchSize: 1,
    supportsImageInput: true,
    supportsNegativePrompt: false,
    estimatedTimeSeconds: 20,
  },
};

export const IMAGE_MODELS = Object.values(MODELS).filter(m => m.type === 'image');
export const VIDEO_MODELS = Object.values(MODELS).filter(m => m.type === 'video');
export const UPSCALE_MODELS = Object.values(MODELS).filter(m => m.type === 'upscale');

export function getModel(id: string): ModelConfig | undefined {
  return MODELS[id];
}

export function getDefaultImageModel(): ModelConfig {
  return MODELS['nano-banana-2'];
}

export function getDefaultVideoModel(): ModelConfig {
  return MODELS['kling-3-pro'];
}
