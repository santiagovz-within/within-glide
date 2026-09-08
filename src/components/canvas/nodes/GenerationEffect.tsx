'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { ImageGeneration, loadImage, type ImageGenerationHandle } from 'img-fx';
import { resolveMediaAsset } from '@/lib/utils/mediaUtils';

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
      theme="dark"
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
