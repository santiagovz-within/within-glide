import { FAL_MODELS, VIDEO_MODELS } from '@/lib/api/models';
import type { VideoGenNodeData } from '@/types';

type VideoResolution = NonNullable<VideoGenNodeData['videoResolution']>;
const LOCKED_RESOLUTIONS: Partial<Record<string, VideoResolution>> = {
  'seedance-2-mini': '720p',
  'kling-3-pro': '1080p',
};
const DURATIONS: Record<string, number[]> = {
  'veo-3-1': [4, 6, 8],
  'kling-4': Array.from({ length: 28 }, (_, index) => index + 3),
  'seedance-2': [4, 5, 8, 10, 15],
  'seedance-2-5': [4, 5, 8, 10, 15, 20, 25, 30],
  'seedance-2-mini': [4, 5, 8, 10],
  'flux-3': [5, 8, 10, 15, 20],
  'minimax-h3': [5, 8, 10, 15],
  'minimax-h3-max': [5, 8, 10, 15],
  'wan-3-prime': [3, 5, 8, 10, 15, 20, 25, 30],
};

/** Shared by the canvas video node and the Image & Video composer. */
export function getVideoGenerationSettings(data: Partial<VideoGenNodeData>) {
  const model = VIDEO_MODELS.find(option => option.id === data.model) ?? VIDEO_MODELS[0];
  const draftMode = model.id === 'seedance-2-5' && data.draftMode === true;
  const lockedResolution = draftMode ? '480p' : LOCKED_RESOLUTIONS[model.id];
  const resolutions = (lockedResolution ? [lockedResolution] : model.supportedResolutions) as VideoResolution[];
  const storedResolution = data.videoResolution ?? data.seedanceResolution;
  const resolution = storedResolution && resolutions.includes(storedResolution) ? storedResolution : resolutions[0];
  const durations = DURATIONS[model.id] ?? [3, 5, 8, 10];
  const defaultDuration = model.id === 'veo-3-1' ? 8 : durations[0];
  const requestedDuration = data.duration ?? (model.id === 'veo-3-1' ? 8 : 5);
  const fal = FAL_MODELS[model.id as keyof typeof FAL_MODELS];
  const followsInputAspect = !!data.startFrameUrl
    && ['kling-3-pro', 'kling-4', 'minimax-h3', 'minimax-h3-max', 'wan-3-prime'].includes(model.id);
  return {
    model, draftMode, lockedResolution, resolutions, durations, resolution,
    duration: durations.includes(requestedDuration) ? requestedDuration : defaultDuration,
    aspectRatio: data.aspectRatio && model.supportedAspectRatios.includes(data.aspectRatio)
      ? data.aspectRatio : model.supportedAspectRatios[0],
    supportsEndFrame: !['flux-3', 'veo-3-1'].includes(model.id),
    supportsAudio: ['seedance-2', 'seedance-2-5', 'seedance-2-mini', 'flux-3', 'kling-3-pro', 'wan-3-prime', 'veo-3-1'].includes(model.id),
    followsInputAspect,
    endpoint: data.startFrameUrl && 'imageToVideoEndpoint' in fal ? fal.imageToVideoEndpoint : fal.endpoint,
  };
}
