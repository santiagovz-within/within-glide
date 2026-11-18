/** fal schemas and published prices checked 2026-11-17:
 * https://fal.ai/models/fal-ai/elevenlabs/music/api
 * https://fal.ai/models/sonilo/v1.1/text-to-music/api
 */
const ELEVENLABS_FORMATS = [
  'mp3_22050_32', 'mp3_44100_32', 'mp3_44100_64', 'mp3_44100_96',
  'mp3_44100_128', 'mp3_44100_192', 'pcm_8000', 'pcm_16000',
  'pcm_22050', 'pcm_24000', 'pcm_44100', 'pcm_48000', 'ulaw_8000',
  'alaw_8000', 'opus_48000_32', 'opus_48000_64', 'opus_48000_96',
  'opus_48000_128', 'opus_48000_192',
];

export const MUSIC_MODELS = [
  {
    id: 'elevenlabs-music', name: 'ElevenLabs Music', endpoint: 'fal-ai/elevenlabs/music',
    minDuration: 3, maxDuration: 600, defaultDuration: 30, maxBatchSize: 4,
    formats: ELEVENLABS_FORMATS, defaultFormat: 'mp3_44100_128', maxPromptLength: 4100,
    billingDescription: '$0.60 per started minute, per track. Estimate includes the entire batch.',
  },
  {
    id: 'sonilo-v1-1', name: 'Sonilo v1.1', endpoint: 'sonilo/v1.1/text-to-music',
    minDuration: 1, maxDuration: 600, defaultDuration: 90, maxBatchSize: 3,
    formats: ['m4a'], defaultFormat: 'm4a', maxPromptLength: undefined,
    billingDescription: '$0.0025 per second, per track (10-second minimum). Estimate includes the entire batch.',
  },
] as const;

export function getMusicModel(id: unknown) {
  return MUSIC_MODELS.find(model => model.id === id);
}

export function musicLengthOptions(modelId: string): number[] {
  const model = getMusicModel(modelId) ?? MUSIC_MODELS[0];
  return [...new Set([model.minDuration, 5, 10, 15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 420, 480, 540, 600])]
    .filter(duration => duration >= model.minDuration);
}

export function musicFormatLabel(format: string): string {
  if (format === 'm4a') return 'AAC / M4A';
  const [codec, rate, bitrate] = format.split('_');
  const name = codec === 'ulaw' ? 'μ-law' : codec === 'alaw' ? 'A-law' : codec.toUpperCase();
  return `${name} · ${Number(rate) / 1000} kHz${bitrate ? ` · ${bitrate} kbps` : ' · raw'}`;
}

export function estimateMusicCost(modelId: string, duration: number, count: number): number {
  return (modelId === 'elevenlabs-music' ? Math.ceil(duration / 60) * 0.6 : Math.max(10, Math.ceil(duration)) * 0.0025) * count;
}

/** A canvas batch uses one recoverable queue request per track for both models. */
export function buildMusicInput(body: Record<string, unknown>) {
  const model = getMusicModel(body.model);
  if (!model) throw new Error('Unknown music model.');
  if (typeof body.prompt !== 'string' || !body.prompt.trim()) throw new Error('Describe the music to generate.');
  if (model.maxPromptLength && body.prompt.length > model.maxPromptLength) throw new Error(`Prompt must be at most ${model.maxPromptLength} characters.`);
  const duration = body.duration;
  if (typeof duration !== 'number' || !Number.isInteger(duration) || duration < model.minDuration || duration > model.maxDuration) {
    throw new Error(`Length must be between ${model.minDuration} and ${model.maxDuration} seconds.`);
  }
  const count = body.generationSlotCount;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > model.maxBatchSize) throw new Error('Invalid music batch size.');
  if (typeof body.slotIndex !== 'number' || !Number.isInteger(body.slotIndex) || body.slotIndex < 0 || body.slotIndex >= count) throw new Error('Invalid music batch slot.');
  const outputFormat = body.outputFormat ?? model.defaultFormat;
  if (typeof outputFormat !== 'string' || !model.formats.some(format => format === outputFormat)) throw new Error('Unsupported output format for this model.');
  const input: Record<string, unknown> = model.id === 'elevenlabs-music'
    ? { prompt: body.prompt.trim(), music_length_ms: duration * 1000, output_format: outputFormat }
    : { prompt: body.prompt.trim(), duration, num_samples: 1 };
  return { model, input, duration, outputFormat };
}

export function musicFileType(format: string): { extension: string; contentType: string } {
  const codec = format.split('_')[0];
  switch (codec) {
    case 'm4a': return { extension: 'm4a', contentType: 'audio/mp4' };
    case 'opus': return { extension: 'opus', contentType: 'audio/ogg' };
    case 'pcm': return { extension: 'pcm', contentType: 'audio/pcm' };
    case 'ulaw': return { extension: 'ulaw', contentType: 'audio/basic' };
    case 'alaw': return { extension: 'alaw', contentType: 'audio/x-alaw' };
    default: return { extension: 'mp3', contentType: 'audio/mpeg' };
  }
}

export function isRawMusicUrl(url: string): boolean {
  return /\.(pcm|ulaw|alaw)(?:\?|$)/i.test(url);
}
