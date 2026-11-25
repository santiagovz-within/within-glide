/** fal schemas and published prices checked 2026-11-25:
 * https://fal.ai/models/fal-ai/elevenlabs/music/api
 * https://fal.ai/models/sonilo/v1.1/text-to-music/api
 * https://fal.ai/models/google/lyria-3.5/api
 * https://fal.ai/models/minimax/music-3/api
 * https://fal.ai/models/fal-ai/stable-audio-25/text-to-audio/api
 */
const ELEVENLABS_FORMATS = [
  'mp3_22050_32', 'mp3_44100_32', 'mp3_44100_64', 'mp3_44100_96',
  'mp3_44100_128', 'mp3_44100_192', 'pcm_8000', 'pcm_16000',
  'pcm_22050', 'pcm_24000', 'pcm_44100', 'pcm_48000', 'ulaw_8000',
  'alaw_8000', 'opus_48000_32', 'opus_48000_64', 'opus_48000_96',
  'opus_48000_128', 'opus_48000_192',
];

interface MusicModel {
  id: string; name: string; endpoint: string;
  minDuration: number; maxDuration: number; defaultDuration: number; maxBatchSize: number;
  formats: readonly string[]; defaultFormat: string; maxPromptLength?: number;
  durationMode?: 'prompt' | 'maximum'; requiresLyrics?: boolean;
  billingDescription: string;
}

export const MUSIC_MODELS: readonly MusicModel[] = [
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
  {
    id: 'lyria-3-5', name: 'Google Lyria 3.5', endpoint: 'google/lyria-3.5',
    minDuration: 1, maxDuration: 180, defaultDuration: 60, maxBatchSize: 4,
    durationMode: 'prompt', formats: ['mp3'], defaultFormat: 'mp3', maxPromptLength: 5000,
    billingDescription: '$0.10 per track. Estimate includes the entire batch.',
  },
  {
    id: 'minimax-music-3', name: 'MiniMax Music 3', endpoint: 'minimax/music-3',
    minDuration: 1, maxDuration: 300, defaultDuration: 60, maxBatchSize: 4,
    durationMode: 'maximum', requiresLyrics: true, formats: ['wav'], defaultFormat: 'wav',
    billingDescription: '$0.002 per second, per track. Estimate uses the maximum length for the entire batch.',
  },
  {
    id: 'stable-audio-2-5', name: 'Stable Audio 2.5', endpoint: 'fal-ai/stable-audio-25/text-to-audio',
    minDuration: 1, maxDuration: 190, defaultDuration: 30, maxBatchSize: 4,
    formats: ['wav'], defaultFormat: 'wav',
    billingDescription: '$0.20 per track. Estimate includes the entire batch.',
  },
];

export function getMusicModel(id: unknown) {
  return MUSIC_MODELS.find(model => model.id === id);
}

export function musicLengthOptions(modelId: string): number[] {
  const model = getMusicModel(modelId) ?? MUSIC_MODELS[0];
  if (model.durationMode === 'prompt') return [];
  return [...new Set([model.minDuration, model.maxDuration, 5, 10, 15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 420, 480, 540, 600])]
    .filter(duration => duration >= model.minDuration && duration <= model.maxDuration).sort((a, b) => a - b);
}

export function musicFormatLabel(format: string): string {
  if (format === 'wav') return 'WAV';
  if (format === 'mp3') return 'MP3';
  if (format === 'm4a') return 'AAC / M4A';
  const [codec, rate, bitrate] = format.split('_');
  const name = codec === 'ulaw' ? 'μ-law' : codec === 'alaw' ? 'A-law' : codec.toUpperCase();
  return `${name} · ${Number(rate) / 1000} kHz${bitrate ? ` · ${bitrate} kbps` : ' · raw'}`;
}

export function estimateMusicCost(modelId: string, duration: number, count: number): number {
  switch (modelId) {
    case 'elevenlabs-music': return Math.ceil(duration / 60) * 0.6 * count;
    case 'sonilo-v1-1': return Math.max(10, Math.ceil(duration)) * 0.0025 * count;
    case 'lyria-3-5': return 0.1 * count;
    case 'minimax-music-3': return duration * 0.002 * count;
    case 'stable-audio-2-5': return 0.2 * count;
    default: throw new Error('Unknown music model.');
  }
}

/** A canvas batch uses one recoverable queue request per track for every model. */
export function buildMusicInput(body: Record<string, unknown>) {
  const model = getMusicModel(body.model);
  if (!model) throw new Error('Unknown music model.');
  if (typeof body.prompt !== 'string' || !body.prompt.trim()) throw new Error('Describe the music to generate.');
  if (model.maxPromptLength && body.prompt.length > model.maxPromptLength) throw new Error(`Prompt must be at most ${model.maxPromptLength} characters.`);
  const duration = model.durationMode === 'prompt' ? null : body.duration;
  if (model.durationMode !== 'prompt' && (typeof duration !== 'number' || !Number.isInteger(duration) || duration < model.minDuration || duration > model.maxDuration)) {
    throw new Error(`Length must be between ${model.minDuration} and ${model.maxDuration} seconds.`);
  }
  const count = body.generationSlotCount;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > model.maxBatchSize) throw new Error('Invalid music batch size.');
  if (typeof body.slotIndex !== 'number' || !Number.isInteger(body.slotIndex) || body.slotIndex < 0 || body.slotIndex >= count) throw new Error('Invalid music batch slot.');
  const outputFormat = body.outputFormat ?? model.defaultFormat;
  if (typeof outputFormat !== 'string' || !model.formats.some(format => format === outputFormat)) throw new Error('Unsupported output format for this model.');
  const input: Record<string, unknown> = { prompt: body.prompt.trim() };
  switch (model.id) {
    case 'elevenlabs-music': Object.assign(input, { music_length_ms: (duration as number) * 1000, output_format: outputFormat }); break;
    case 'sonilo-v1-1': Object.assign(input, { duration, num_samples: 1 }); break;
    case 'lyria-3-5': break; // Length and arrangement are expressed in the prompt.
    case 'minimax-music-3': {
      if (typeof body.lyrics !== 'string' || !body.lyrics.trim()) throw new Error('Enter lyrics for MiniMax Music 3.');
      // fal drops lyrics on a section-tag line, so preserve them on the next line.
      const lyrics = body.lyrics.trim().replace(/^(\s*\[(?:intro|verse|pre-chorus|chorus|post-chorus|bridge|instrumental|solo|outro)\])[^\S\n]*(?=\S)/gim, '$1\n');
      Object.assign(input, { duration, lyrics });
      break;
    }
    case 'stable-audio-2-5': input.seconds_total = duration; break;
  }
  return { model, input, duration, outputFormat };
}

export function musicFileType(format: string): { extension: string; contentType: string } {
  const codec = format.split('_')[0];
  switch (codec) {
    case 'wav': return { extension: 'wav', contentType: 'audio/wav' };
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
