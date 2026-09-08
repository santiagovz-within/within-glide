'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ImageGeneration,
  PRESETS,
  getMaxDpr,
  loadImage,
  type ImageGenerationHandle,
} from 'img-fx';
import { resolveMediaAsset } from '@/lib/utils/mediaUtils';
import styles from './GenerationEffect.module.css';

const PIXEL_SCALE = 0.5;

/** Match img-fx 0.5's 320px reference grid, including its render-DPR rounding. */
function syncRoundedCellGrid(root: HTMLDivElement, shader: HTMLCanvasElement) {
  const canvasDpr = Math.min(window.devicePixelRatio || 1, 2);
  const shaderDpr = Math.min(window.devicePixelRatio || 1, getMaxDpr());
  const bounds = root.getBoundingClientRect();
  // Canvas dimensions reflect the size the engine last rendered, even while
  // React Flow is zooming and the enclosing DOM transform changes independently.
  const width = shader.hasAttribute('width')
    ? shader.width / canvasDpr
    : Math.round(bounds.width);
  const height = shader.hasAttribute('height')
    ? shader.height / canvasDpr
    : Math.round(bounds.height);
  const baseCount =
    (6 + PRESETS['pixels-organic'].modes.dark.pixelConfig.cellSize * 74) /
    PIXEL_SCALE;
  const count = (size: number) =>
    Math.max(2, Math.floor((baseCount * size) / 320));
  root.style.setProperty(
    '--shader-columns',
    String(count(Math.floor(width * shaderDpr) / shaderDpr)),
  );
  root.style.setProperty(
    '--shader-rows',
    String(count(Math.floor(height * shaderDpr) / shaderDpr)),
  );
  root.style.setProperty('--reveal-columns', String(count(width)));
  root.style.setProperty('--reveal-rows', String(count(height)));
}

function getReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function subscribeReducedMotion(update: () => void) {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  media.addEventListener('change', update);
  return () => media.removeEventListener('change', update);
}

/** External videos may not have a stored poster. Capture just their first frame. */
function firstFrame(url: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const cleanup = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      video.onloadeddata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
    };
    const abort = () => {
      cleanup();
      reject(new Error('Video preview unavailable'));
    };
    const timeout = setTimeout(abort, 8000);
    signal.addEventListener('abort', abort, { once: true });
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.muted = true;
    video.onloadeddata = () => {
      try {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 1024 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Video preview unavailable');
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg'));
        cleanup();
      } catch {
        abort();
      }
    };
    video.onerror = abort;
    video.src = url;
  });
}

export default function GenerationEffect({
  source,
  kind,
  onComplete,
  onFallback,
}: {
  source?: string;
  kind: 'image' | 'video';
  onComplete: () => void;
  onFallback: () => void;
}) {
  const ref = useRef<ImageGenerationHandle>(null);
  const [image, setImage] = useState<{ source: string; url: string }>();
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotion,
    () => true,
  );
  const [phase, setPhase] = useState('idle');
  const currentUrl = image?.source === source ? image?.url : undefined;
  const images = useMemo(() => (currentUrl ? [currentUrl] : []), [currentUrl]);

  useEffect(() => {
    const root = ref.current?.element;
    const shader = root?.querySelector<HTMLCanvasElement>('.image-gen-shader');
    if (reducedMotion || !root || !shader) return;
    const sync = () => syncRoundedCellGrid(root, shader);
    sync();
    const resize = new ResizeObserver(sync);
    resize.observe(root);
    const bitmapResize = new MutationObserver(sync);
    bitmapResize.observe(shader, {
      attributes: true,
      attributeFilter: ['width', 'height'],
    });
    return () => {
      resize.disconnect();
      bitmapResize.disconnect();
    };
  }, [reducedMotion]);

  useEffect(() => {
    if (!source) return;
    if (reducedMotion) {
      onFallback();
      return;
    }
    const controller = new AbortController();
    // Covers signing, decoding, missing WebGL, and library reveal failures.
    const timeout = setTimeout(onFallback, 15000);
    void (async () => {
      const asset = await resolveMediaAsset(source, kind);
      if (controller.signal.aborted) return;
      const url =
        kind === 'image'
          ? asset.original
          : (asset.poster ??
            (await firstFrame(asset.original, controller.signal)));
      await loadImage(url);
      if (!controller.signal.aborted) setImage({ source, url });
    })().catch(() => {
      if (!controller.signal.aborted) onFallback();
    });
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [kind, onFallback, reducedMotion, source]);

  useEffect(() => {
    if (!currentUrl || reducedMotion) return;
    // Child passive effects install the updated image pool before this fires.
    const frame = requestAnimationFrame(() =>
      ref.current?.triggerReveal({ hold: 'manual' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [currentUrl, reducedMotion]);

  if (reducedMotion) return null;
  return (
    <ImageGeneration
      ref={ref}
      preset="pixels-organic"
      pixelScale={PIXEL_SCALE}
      theme="dark"
      className={styles.roundedCells}
      images={images}
      autoReveal={false}
      data-reveal-phase={phase}
      onCycle={(event) => {
        setPhase(event.phase);
        if (event.phase === 'visible') onComplete();
      }}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        borderRadius: 'inherit',
      }}
    >
      <div style={{ width: '100%', height: '100%', borderRadius: 'inherit' }} />
    </ImageGeneration>
  );
}
