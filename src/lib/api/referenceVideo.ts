// Source schemas: https://fal.ai/models/{endpoint}/api (including OpenAPI bounds).
// Kept separate from text/image-to-video: references do not select a start frame.
export interface ReferenceVideoModel {
  id: string;
  name: string;
  endpoint: string;
  aspectRatios: string[];
  resolutions: string[];
  minDuration: number;
  maxDuration: number;
  defaultDuration: number | 'auto';
  defaultAspectRatio: string;
  defaultResolution: string;
  autoDuration?: 'auto' | 'null';
  audioParam?: 'generate_audio' | 'audio';
  imageParam: 'image_urls' | 'reference_image_urls';
  videoParam: 'video_urls' | 'reference_video_urls';
  maxImages: number;
  maxVideos: number;
  maxReferences: number;
  referenceHint: string;
  videoHint: string;
}

const seedanceAspects = ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
export const REFERENCE_VIDEO_MODELS: ReferenceVideoModel[] = [
  {
    id: 'seedance-2-5', name: 'Seedance 2.5',
    endpoint: 'bytedance/seedance-2.5/reference-to-video',
    aspectRatios: seedanceAspects, resolutions: ['480p', '720p', '1080p'],
    minDuration: 4, maxDuration: 30, defaultDuration: 'auto',
    defaultAspectRatio: 'auto', defaultResolution: '720p', autoDuration: 'auto',
    audioParam: 'generate_audio', imageParam: 'image_urls', videoParam: 'video_urls',
    maxImages: 30, maxVideos: 10, maxReferences: 50,
    referenceHint: 'Refer to images as @Image1, @Image2 and videos as @Video1, @Video2.',
    videoHint: 'MP4/MOV, 1.8–30.2s per clip and 30.2s total; up to 200 MB each. 300–6,000 px per side, aspect ratio 0.4–2.5, 24–60 fps.',
  },
  {
    id: 'seedance-2', name: 'Seedance 2.0',
    endpoint: 'bytedance/seedance-2.0/reference-to-video',
    aspectRatios: seedanceAspects, resolutions: ['480p', '720p', '1080p', '4k'],
    minDuration: 4, maxDuration: 15, defaultDuration: 'auto',
    defaultAspectRatio: 'auto', defaultResolution: '720p', autoDuration: 'auto',
    audioParam: 'generate_audio', imageParam: 'image_urls', videoParam: 'video_urls',
    maxImages: 9, maxVideos: 3, maxReferences: 12,
    referenceHint: 'Refer to images as @Image1, @Image2 and videos as @Video1, @Video2.',
    videoHint: 'MP4/MOV, 2–15s combined, under 50 MB total; approximately 480p–720p.',
  },
  {
    id: 'google-omni-flash', name: 'Gemini Omni Flash 1.1',
    endpoint: 'google/gemini-omni-flash/v1.1/reference-to-video',
    aspectRatios: ['16:9', '9:16'], resolutions: ['360p', '720p', '1080p', '4k'],
    minDuration: 3, maxDuration: 10, defaultDuration: 8,
    defaultAspectRatio: '16:9', defaultResolution: '720p',
    imageParam: 'image_urls', videoParam: 'reference_video_urls',
    maxImages: 10, maxVideos: 3, maxReferences: 13,
    referenceHint: 'Refer to images as <IMAGE_REF_0>, <IMAGE_REF_1> and videos as <VIDEO_REF_0>, <VIDEO_REF_1>.',
    videoHint: 'Each reference video must be at most 3 seconds long.',
  },
  {
    id: 'minimax-h3-max', name: 'MiniMax H3 Max',
    endpoint: 'minimax/h3-max/reference-to-video',
    aspectRatios: ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    resolutions: ['480P', '768P', '1080P'],
    minDuration: 5, maxDuration: 15, defaultDuration: 5,
    defaultAspectRatio: 'adaptive', defaultResolution: '768P',
    imageParam: 'reference_image_urls', videoParam: 'reference_video_urls',
    maxImages: 9, maxVideos: 3, maxReferences: 12,
    referenceHint: 'Refer to images as Image 1, Image 2 and videos as Video 1, Video 2.',
    videoHint: 'Each clip must be 2–15 seconds, with at most 15 seconds combined.',
  },
  {
    id: 'wan-3-prime', name: 'Wan 3 Prime',
    endpoint: 'alibaba/wan-3.0-prime/reference-to-video',
    aspectRatios: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16'],
    resolutions: ['480p', '720p', '1080p'],
    minDuration: 2, maxDuration: 30, defaultDuration: 5,
    defaultAspectRatio: 'adaptive', defaultResolution: '1080p', autoDuration: 'null',
    audioParam: 'audio', imageParam: 'reference_image_urls', videoParam: 'reference_video_urls',
    maxImages: 10, maxVideos: 5, maxReferences: 15,
    referenceHint: 'Refer to images as Image 1, Image 2 and videos as Video 1, Video 2.',
    videoHint: 'At most 15 seconds combined; each clip must be at least 16 fps.',
  },
];

export function getReferenceVideoModel(model: string) {
  return REFERENCE_VIDEO_MODELS.find(option => option.id === model);
}

export function referenceDurationOptions(model: ReferenceVideoModel): Array<number | 'auto'> {
  return [
    ...(model.autoDuration ? ['auto' as const] : []),
    ...Array.from({ length: model.maxDuration - model.minDuration + 1 }, (_, i) => model.minDuration + i),
  ];
}

/** Shared by the node and the API so invalid requests never reach the paid queue. */
export function buildReferenceVideoInput(body: Record<string, unknown>) {
  const model = getReferenceVideoModel(String(body.model));
  if (!model) throw new Error('Unknown reference-to-video model.');
  const prompt = body.prompt;
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Enter a prompt.');
  const aspectRatio = body.aspectRatio ?? model.defaultAspectRatio;
  const resolution = body.videoResolution ?? model.defaultResolution;
  const duration = body.referenceDuration ?? model.defaultDuration;
  if (typeof aspectRatio !== 'string' || !model.aspectRatios.includes(aspectRatio)) {
    throw new Error(`${model.name} does not support that aspect ratio.`);
  }
  if (typeof resolution !== 'string' || !model.resolutions.includes(resolution)) {
    throw new Error(`${model.name} does not support that resolution.`);
  }
  if (!referenceDurationOptions(model).includes(duration as number | 'auto')) {
    throw new Error(`${model.name} duration must be ${model.minDuration}–${model.maxDuration} seconds${model.autoDuration ? ' or Auto' : ''}.`);
  }
  if (body.generateAudio !== undefined && typeof body.generateAudio !== 'boolean') {
    throw new Error('Generate audio must be a boolean.');
  }
  function readUrls(value: unknown, limit: number, kind: string): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some(url => typeof url !== 'string' || !url.trim())) {
      throw new Error(`Provide valid ${kind} reference URLs.`);
    }
    if (value.length > limit) throw new Error(`${model!.name} accepts up to ${limit} ${kind} references.`);
    return value;
  }
  const imageUrls = readUrls(body.referenceImageUrls, model.maxImages, 'image');
  const videoUrls = readUrls(body.referenceVideoUrls, model.maxVideos, 'video');
  if (!imageUrls.length && !videoUrls.length) throw new Error('Connect at least one image or video reference.');
  if (imageUrls.length + videoUrls.length > model.maxReferences) {
    throw new Error(`${model.name} accepts up to ${model.maxReferences} references in total.`);
  }
  const input: Record<string, unknown> = {
    prompt: compileReferenceVideoPrompt(prompt, model.id, imageUrls, videoUrls),
    aspect_ratio: aspectRatio,
    resolution,
    duration: duration === 'auto' ? (model.autoDuration === 'null' ? null : 'auto')
      : model.autoDuration === 'auto' ? String(duration) : duration,
    [model.imageParam]: imageUrls,
    [model.videoParam]: videoUrls,
    ...(model.audioParam ? { [model.audioParam]: body.generateAudio ?? true } : {}),
    ...(model.id === 'seedance-2-5' ? { task: 'reference' } : {}),
    ...(model.id === 'minimax-h3-max' ? { prompt_expansion_mode: 'balanced' } : {}),
  };
  return { endpoint: model.endpoint, input };
}

/** The arrays and the prompt share modality-specific positions; URLs remain real media inputs. */
export function compileReferenceVideoPrompt(prompt: string, model: string, imageUrls: string[], videoUrls: string[]) {
  return prompt.replace(/(?<![\w])@(image|video)(\d+)(?![\w])/g, (_token, kind: string, number: string) => {
    const index = Number(number) - 1;
    const urls = kind === 'image' ? imageUrls : videoUrls;
    if (!Number.isInteger(index) || index < 0 || !urls[index]) {
      throw new Error(`@${kind}${number} has no connected ${kind}. Connect it or remove the tag.`);
    }
    if (model === 'google-omni-flash') return `<${kind.toUpperCase()}_REF_${index}>`;
    const modality = kind === 'image' ? 'Image' : 'Video';
    return model.startsWith('seedance') ? `@${modality}${index + 1}` : `${modality} ${index + 1}`;
  });
}
