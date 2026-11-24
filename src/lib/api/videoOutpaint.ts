import { FAL_NODE_ENDPOINTS } from '@/lib/api/models';

export const VIDEO_OUTPAINT_MODELS = [
  { id: 'ltx-2.3', name: 'LTX 2.3 Outpaint', endpoint: FAL_NODE_ENDPOINTS.videoOutpaint.endpoint,
    aspects: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', '9:21'], resolutions: ['720p', '1080p'],
    defaultResolution: '720p', prompt: 'required', placement: false, maxDuration: null,
    hint: 'Prompt-guided expansion. Output has no audio.' },
  { id: 'ltx-2.5', name: 'LTX 2.5 Reframe', endpoint: FAL_NODE_ENDPOINTS.videoReframeLtx25.endpoint,
    aspects: ['16:9', '9:16', '1:1', '4:5', '5:4'], resolutions: ['720p', '1080p'],
    defaultResolution: '720p', prompt: 'none', placement: true, maxDuration: 60,
    hint: 'Automatically fills the surroundings. Position and scale the original inside the new frame.' },
  { id: 'luma-ray-3.2', name: 'Luma Ray 3.2 Reframe', endpoint: FAL_NODE_ENDPOINTS.videoReframeLuma.endpoint,
    aspects: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], resolutions: ['540p', '720p', '1080p'],
    defaultResolution: '720p', prompt: 'required', placement: true, maxDuration: 10,
    hint: 'Describe the new surroundings. Source clips must be 10 seconds or less.' },
  { id: 'minimax-h3-max', name: 'MiniMax H3 Max Reframe', endpoint: FAL_NODE_ENDPOINTS.videoReframeMinimax.endpoint,
    aspects: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '9:21'], resolutions: ['480p', '768p', '1080p'],
    defaultResolution: '768p', prompt: 'optional', placement: false, maxDuration: 300,
    hint: 'Preserves source audio and timing. 1080p is upscaled from 768p; long clips also bill overlapping sections.' },
] as const;

export const VIDEO_OUTPAINT_ANCHORS = ['center', 'top', 'bottom', 'left', 'right', 'top_left', 'top_right', 'bottom_left', 'bottom_right'] as const;
export type VideoOutpaintAnchor = typeof VIDEO_OUTPAINT_ANCHORS[number];

/** Missing model IDs belong to saved LTX 2.3 nodes and in-flight legacy jobs. */
export function getVideoOutpaintModel(id?: string) {
  return VIDEO_OUTPAINT_MODELS.find(model => model.id === (id ?? 'ltx-2.3'));
}

export function getVideoOutpaintSettings(data: { outpaintModel?: string; outpaintAspectRatio?: string; outpaintResolution?: string }) {
  const model = getVideoOutpaintModel(data.outpaintModel) ?? VIDEO_OUTPAINT_MODELS[0];
  return { model,
    aspectRatio: (model.aspects as readonly string[]).includes(data.outpaintAspectRatio ?? '') ? data.outpaintAspectRatio! : '16:9',
    resolution: (model.resolutions as readonly string[]).includes(data.outpaintResolution ?? '') ? data.outpaintResolution! : model.defaultResolution,
  };
}

/** Fit the entire source, then align it in the remaining canvas. Shared with preview. */
export function videoOutpaintPlacement(width: number, height: number, aspectRatio: string, anchor: VideoOutpaintAnchor, scale = 1) {
  const [w, h] = aspectRatio.split(':').map(Number);
  const relativeAspect = (width / height) / (w / h);
  const sourceWidth = Math.min(1, relativeAspect) * scale;
  const sourceHeight = Math.min(1, 1 / relativeAspect) * scale;
  return {
    x: anchor.includes('left') ? 0 : anchor.includes('right') ? 1 - sourceWidth : (1 - sourceWidth) / 2,
    y: anchor.includes('top') ? 0 : anchor.includes('bottom') ? 1 - sourceHeight : (1 - sourceHeight) / 2,
    width: sourceWidth, height: sourceHeight,
  };
}

export interface VideoOutpaintRequest {
  model?: string;
  videoUrl: string;
  aspectRatio?: string;
  resolution?: string;
  prompt?: string;
  negativePrompt?: string;
  fps?: number;
  numFrames?: number;
  duration?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  anchor?: VideoOutpaintAnchor;
  sourceScale?: number;
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function buildVideoOutpaintInput(body: VideoOutpaintRequest) {
  const model = getVideoOutpaintModel(body.model);
  if (!model) throw new Error('Unsupported video expansion model.');
  if (typeof body.videoUrl !== 'string' || !body.videoUrl.trim()) throw new Error('A source video is required.');
  const aspectRatio = body.aspectRatio ?? '16:9';
  const resolution = body.resolution ?? model.defaultResolution;
  if (!(model.aspects as readonly string[]).includes(aspectRatio)) throw new Error('Unsupported aspect ratio for this model.');
  if (!(model.resolutions as readonly string[]).includes(resolution)) throw new Error('Unsupported resolution for this model.');
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (model.prompt === 'required' && !prompt) throw new Error('A prompt is required.');
  if (model.maxDuration && (!positive(body.duration) || body.duration > model.maxDuration)) {
    throw new Error(`Source duration must be known and no longer than ${model.maxDuration} seconds.`);
  }
  if (model.id === 'minimax-h3-max' && body.duration! < 0.25) throw new Error('MiniMax requires at least 0.25 seconds of video.');
  const input: Record<string, unknown> = { video_url: body.videoUrl, aspect_ratio: aspectRatio };
  if (model.id === 'ltx-2.3') {
    const fps = body.fps ?? 24;
    if (![24, 30, 60].includes(fps)) throw new Error('Unsupported frame rate.');
    if (body.numFrames !== undefined && (!Number.isInteger(body.numFrames) || body.numFrames <= 0)) throw new Error('Invalid frame count.');
    const [w, h] = aspectRatio.split(':').map(Number);
    const height = resolution === '1080p' ? 1080 : 720;
    Object.assign(input, { prompt, negative_prompt: body.negativePrompt?.trim() || undefined,
      output_resolution: resolution, resolution: { width: Math.round(height * w / h), height },
      frames_per_second: fps, ...(body.numFrames ? { num_frames: body.numFrames } : {}),
      source_scale: 1, generate_audio: false, video_strength: 1, num_inference_steps: 15,
      guidance_scale: 1, enable_prompt_expansion: true, video_quality: 'high', video_write_mode: 'balanced' });
  } else {
    input.resolution = resolution;
    if (model.prompt !== 'none' && prompt) input.prompt = prompt;
    if (model.placement) {
      const anchor = body.anchor ?? 'center';
      const scale = body.sourceScale ?? 1;
      if (!VIDEO_OUTPAINT_ANCHORS.includes(anchor) || !positive(scale) || scale < 0.5 || scale > 1) throw new Error('Invalid source placement.');
      if (!positive(body.sourceWidth) || !positive(body.sourceHeight)) throw new Error('Source video dimensions are required.');
      const rect = videoOutpaintPlacement(body.sourceWidth, body.sourceHeight, aspectRatio, anchor, scale);
      if (model.id === 'ltx-2.5') {
        const [w, h] = aspectRatio.split(':').map(Number);
        const shortEdge = resolution === '1080p' ? 1080 : 720;
        const outputWidth = shortEdge * Math.max(1, w / h);
        if (outputWidth * rect.width > body.sourceWidth * 2 + 0.01) throw new Error('LTX 2.5 allows up to 2× source enlargement. Lower the resolution or source scale.');
        input.placement = rect;
      } else {
        input.source_position = { x_norm: rect.x, y_norm: rect.y, w_norm: rect.width, h_norm: rect.height };
      }
    }
  }
  return { model, input, aspectRatio, resolution };
}

export function getVideoOutpaintEndpoint(parameters: unknown, savedModel?: string) {
  const endpoint = parameters && typeof parameters === 'object' && 'endpoint' in parameters
    ? parameters.endpoint : savedModel ?? FAL_NODE_ENDPOINTS.videoOutpaint.endpoint;
  if (!VIDEO_OUTPAINT_MODELS.some(model => model.endpoint === endpoint)) throw new Error('Unknown saved video expansion endpoint.');
  return endpoint as string;
}
