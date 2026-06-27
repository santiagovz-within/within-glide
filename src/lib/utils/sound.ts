import { useThemeStore } from '@/lib/stores/themeStore';

let _audio: HTMLAudioElement | null = null;

export function playSuccessSound(): void {
  if (typeof window === 'undefined') return;
  if (!useThemeStore.getState().soundEnabled) return;
  try {
    if (!_audio) _audio = new Audio('/sounds/success.mp3');
    _audio.currentTime = 0;
    _audio.play().catch(() => {});
  } catch {
    // ignore
  }
}
