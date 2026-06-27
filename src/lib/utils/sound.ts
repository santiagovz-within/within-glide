// Plays /sounds/success.mp3. Silently ignored if the browser blocks autoplay
// or if the file is missing (e.g. during development before the asset is added).
let _audio: HTMLAudioElement | null = null;

export function playSuccessSound(): void {
  if (typeof window === 'undefined') return;
  try {
    if (!_audio) _audio = new Audio('/sounds/success.mp3');
    _audio.currentTime = 0;
    _audio.play().catch(() => {});
  } catch {
    // Ignore any instantiation errors
  }
}
