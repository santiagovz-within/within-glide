export const ASPECT_RATIOS = [
  { value: '1:1', label: '1:1 Square' },
  { value: '16:9', label: '16:9 Landscape' },
  { value: '9:16', label: '9:16 Portrait' },
  { value: '4:3', label: '4:3 Standard' },
  { value: '3:4', label: '3:4 Portrait' },
  { value: '4:5', label: '4:5 Instagram' },
  { value: '21:9', label: '21:9 Cinematic' },
] as const;

export const RESOLUTIONS = [
  { value: '1K', label: '1K (~1024px)', pixels: 1024 },
  { value: '2K', label: '2K (~2048px)', pixels: 2048 },
  { value: '4K', label: '4K (~4096px)', pixels: 4096 },
] as const;

export const QUALITY_LEVELS = [
  { value: 'low', label: 'Low', steps: 20 },
  { value: 'medium', label: 'Medium', steps: 28 },
  { value: 'high', label: 'High', steps: 40 },
] as const;

export const MAX_UPLOAD_SIZE_BYTES = 20 * 1024 * 1024; // 20MB
export const MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

export const ACCEPTED_IMAGE_TYPES = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
};

export const GENERATION_EXPIRY_DAYS = 30;

export const POLLING_INTERVAL_MS = 3000;
export const MAX_POLL_ATTEMPTS = 100; // ~5 minutes

export const AUTOSAVE_DEBOUNCE_MS = 2000;
