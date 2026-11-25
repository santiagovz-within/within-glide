import { MODELS, getDefaultImageModel, getDefaultVideoModel } from '@/lib/api/models';
import { getVideoGenerationSettings } from '@/lib/videoGenerationSettings';
import type { ChatMode, ChatSettings } from '@/types';

export function normalizeChatSettings(mode: ChatMode, settings: ChatSettings): ChatSettings {
  const candidate = MODELS[settings.model];
  const model = candidate?.type === mode ? candidate : mode === 'image' ? getDefaultImageModel() : getDefaultVideoModel();
  if (mode === 'video') {
    // Keep the full-quality resolution when toggling drafts; the effective value is 480p.
    const video = getVideoGenerationSettings({ ...settings, model: model.id, draftMode: false });
    return { ...settings, model: model.id, aspectRatio: video.aspectRatio, duration: video.duration,
      videoResolution: video.resolution, draftMode: model.id === 'seedance-2-5' && settings.draftMode === true };
  }
  return { ...settings, model: model.id, draftMode: false,
    aspectRatio: model.supportedAspectRatios.includes(settings.aspectRatio) ? settings.aspectRatio : model.supportedAspectRatios[0],
    resolution: model.supportedResolutions.includes(settings.resolution) ? settings.resolution : model.supportedResolutions[0] ?? '1K',
  };
}

export function buildChatGenerationRequest(
  mode: ChatMode, settings: ChatSettings, prompt: string, referenceImages: string[], sessionId: string,
) {
  const normalized = normalizeChatSettings(mode, settings);
  const common = { model: normalized.model, prompt, aspectRatio: normalized.aspectRatio,
    sourceType: 'chat' as const, sourceId: sessionId };
  if (mode === 'image') return { ...common, resolution: normalized.resolution, numImages: 1,
    referenceImageUrls: referenceImages.filter(Boolean) };
  const video = getVideoGenerationSettings({ ...normalized, startFrameUrl: referenceImages[0] });
  return { ...common, duration: video.duration, videoResolution: video.resolution,
    draft: video.draftMode, generateAudio: video.supportsAudio ? normalized.generateAudio ?? true : undefined,
    startFrameUrl: referenceImages[0] || undefined,
    endFrameUrl: video.supportsEndFrame ? referenceImages[1] || undefined : undefined };
}
