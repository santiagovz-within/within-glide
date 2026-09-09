/** Fit the UI resolution tier to GPT Image 2.5's documented size constraints. */
export function getGptImage25Size(
  aspectRatio: string,
  resolution: string,
): { width: number; height: number } | null {
  const parts = aspectRatio.split(':').map(Number);
  if (parts.length !== 2 || parts.some(value => !Number.isFinite(value) || value <= 0)) return null;
  const ratio = parts[0] / parts[1];
  if (ratio < 1 / 3 || ratio > 3) return null;
  const edge = resolution === '4K' ? 3840 : resolution === '2K' ? 2048 : resolution === '1K' ? 1024 : null;
  if (!edge) return null;

  const width = ratio >= 1 ? edge : edge * ratio;
  const height = ratio >= 1 ? edge / ratio : edge;
  const pixels = width * height;
  const minPixels = 655_360;
  const maxPixels = 8_294_400;
  const scale = Math.sqrt(Math.min(maxPixels, Math.max(minPixels, pixels)) / pixels);
  // Round upward at the minimum and downward otherwise so quantization cannot
  // cross the pixel limits. Both dimensions must be multiples of 16.
  const round = pixels < minPixels ? Math.ceil : Math.floor;
  const size = {
    width: round(width * scale / 16) * 16,
    height: round(height * scale / 16) * 16,
  };
  // Quantization near 3:1 can push the final ratio past the accepted limit.
  if (size.width > size.height * 3) size.height = Math.ceil(size.width / 48) * 16;
  if (size.height > size.width * 3) size.width = Math.ceil(size.height / 48) * 16;
  return size;
}
