export const LAYERIZE_ENDPOINT = 'bytedance/seedream/v5/pro/layerize';

export interface FalLayer {
  image: { url: string; width?: number; height?: number };
  z_index: number;
  bounding_box?: { absolute?: number[]; normalized?: number[] };
  name?: string;
  description?: string;
}

export interface LayerBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EditableLayer {
  id: string;
  imageUrl: string;
  name: string;
  description: string;
  original: LayerBounds;
  bounds: LayerBounds;
  originalOrder: number;
  visible: boolean;
}

// Bounds are expressed in base-image pixels, independent of preview size or zoom.
export function createEditableLayers(layers: FalLayer[], width: number, height: number): EditableLayer[] {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Layerize returned invalid canvas dimensions.');
  }
  return [...layers].sort((a, b) => a.z_index - b.z_index).map((layer, index) => {
    const box = layer.bounding_box;
    const coords = box?.absolute ?? box?.normalized?.map((value, i) => value / 1000 * (i % 2 ? height : width));
    const [left, top, right, bottom] = coords ?? [0, 0, width, height];
    const bounds = { x: left, y: top, width: right - left, height: bottom - top };
    if (!Object.values(bounds).every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) {
      throw new Error('Layerize returned invalid layer bounds.');
    }
    return {
      id: `layer-${index}`,
      imageUrl: layer.image.url,
      name: layer.name || (index === 0 ? 'Background' : `Layer ${index}`),
      description: layer.description || '',
      original: { ...bounds },
      bounds,
      originalOrder: index,
      visible: true,
    };
  });
}

export function arrangeOriginal(layers: EditableLayer[]): EditableLayer[] {
  return [...layers].sort((a, b) => a.originalOrder - b.originalOrder)
    .map(layer => ({ ...layer, bounds: { ...layer.original }, visible: true }));
}

export function layerCanvasSize(layers: EditableLayer[]) {
  const base = layers.find(layer => layer.originalOrder === 0);
  return { width: base?.original.width ?? 1, height: base?.original.height ?? 1 };
}

export function sameLayerizeSource(a?: string, b?: string): boolean {
  if (!a || !b) return a === b;
  // Signed storage URLs are refreshed whenever a saved flow is reopened.
  const identity = (value: string) => /^https:\/\/storage\.googleapis\.com\//.test(value) ? value.split('?')[0] : value;
  return identity(a) === identity(b);
}
