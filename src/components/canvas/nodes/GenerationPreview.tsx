'use client';

import dynamic from 'next/dynamic';
import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { resolveMediaAsset } from '@/lib/utils/mediaUtils';

const GenerationEffect = dynamic(() => import('./GenerationEffect'), {
  ssr: false,
});

function nativeMediaReady(content: HTMLDivElement) {
  const images = [...content.querySelectorAll('img')];
  if (images.length)
    return images.every((image) => image.complete && image.naturalWidth > 0);
  return [...content.querySelectorAll('video')].some(
    (video) => video.readyState >= 2,
  );
}

function LoadingFallback() {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{
        background: 'var(--color-bg-surface)',
        color: 'var(--color-white-muted)',
        fontSize: 12,
      }}
    >
      Generating…
    </div>
  );
}

class EffectBoundary extends Component<
  { children: ReactNode; pending: boolean; onComplete: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    if (!this.props.pending) this.props.onComplete();
  }
  componentDidUpdate() {
    if (this.state.failed && !this.props.pending) this.props.onComplete();
  }
  render() {
    return this.state.failed ? <LoadingFallback /> : this.props.children;
  }
}

interface GenerationPreviewProps {
  pending: boolean;
  failed?: boolean;
  resultSrc?: string | null;
  kind?: 'image' | 'video';
  /** Existing selected/output aspect ratio takes precedence over measured input. */
  aspectRatio?: CSSProperties['aspectRatio'];
  sizingSource?: string;
  sizingKind?: 'image' | 'video';
  fill?: boolean;
  transient?: boolean;
  children?: ReactNode;
}

/** Keep this mounted across pending -> completed, including each individual batch slot. */
export function GenerationPreview({
  pending,
  failed = false,
  resultSrc,
  kind = 'image',
  aspectRatio,
  sizingSource,
  sizingKind = kind,
  fill = false,
  transient = false,
  children,
}: GenerationPreviewProps) {
  const [session, setSession] = useState({
    pending,
    active: pending,
    version: 0,
    result: resultSrc,
  });
  const [measured, setMeasured] = useState<{ source: string; ratio: number }>();
  const contentRef = useRef<HTMLDivElement>(null);

  // Only an observed generation starts an animation. Restored media and history
  // changes stay static; another pending edge cancels the previous reveal.
  const changedResult =
    !pending &&
    !session.pending &&
    session.active &&
    session.result !== resultSrc;
  if (
    changedResult ||
    (pending && !failed && !session.active) ||
    session.pending !== pending ||
    (session.active && (failed || (!pending && !resultSrc)))
  ) {
    setSession({
      pending,
      active:
        !failed &&
        !changedResult &&
        (pending || (!!resultSrc && session.active)),
      result: resultSrc,
      version: session.version + (pending && !session.pending ? 1 : 0),
    });
  }
  const active = session.active && !failed && (pending || !!resultSrc);
  const version = session.version;
  const finish = useCallback(() => {
    setSession((current) =>
      current.version === version && !current.pending && current.active
        ? { ...current, active: false }
        : current,
    );
  }, [version]);

  useEffect(() => {
    if (aspectRatio || !sizingSource || measured?.source === sizingSource)
      return;
    let cancelled = false;
    let image: HTMLImageElement | undefined;
    let video: HTMLVideoElement | undefined;
    void resolveMediaAsset(sizingSource, sizingKind)
      .then((asset) => {
        if (cancelled) return;
        const record = (width: number, height: number) => {
          if (!cancelled && width > 0 && height > 0)
            setMeasured({ source: sizingSource, ratio: width / height });
        };
        if (sizingKind === 'video' && !asset.poster) {
          // Probe external video dimensions only for an active generation.
          if (!pending) return;
          video = document.createElement('video');
          video.preload = 'metadata';
          video.onloadedmetadata = () =>
            record(video!.videoWidth, video!.videoHeight);
          video.src = asset.original;
        } else {
          image = new window.Image();
          image.onload = () =>
            record(image!.naturalWidth, image!.naturalHeight);
          image.src = asset.poster ?? asset.thumbnail ?? asset.original;
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (image) image.onload = null;
      if (video) {
        video.onloadedmetadata = null;
        video.removeAttribute('src');
        video.load();
      }
    };
  }, [aspectRatio, measured?.source, pending, sizingKind, sizingSource]);

  // Let the real canvas media finish loading under the last reveal frame before
  // releasing the overlay, including deferred LOD thumbnails and video posters.
  const revealComplete = useCallback(() => {
    const content = contentRef.current;
    if (!content) {
      finish();
      return;
    }
    if (nativeMediaReady(content)) {
      finish();
      return;
    }
    content.dispatchEvent(new Event('generation:revealed'));
  }, [finish]);

  useEffect(() => {
    const content = contentRef.current;
    if (!active || pending || !content) return;
    let observer: MutationObserver | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      if (nativeMediaReady(content)) finish();
    };
    const revealed = () => {
      observer?.disconnect();
      observer = new MutationObserver(check);
      observer.observe(content, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src'],
      });
      content.addEventListener('load', check, true);
      content.addEventListener('loadeddata', check, true);
      // A missing poster or failed native image must never trap the preview.
      timer = setTimeout(finish, 4000);
      check();
    };
    content.addEventListener('generation:revealed', revealed);
    return () => {
      content.removeEventListener('generation:revealed', revealed);
      content.removeEventListener('load', check, true);
      content.removeEventListener('loadeddata', check, true);
      observer?.disconnect();
      clearTimeout(timer);
    };
  }, [active, finish, pending]);

  if (!active && (transient || !children)) return null;
  const ratio =
    aspectRatio ??
    (measured?.source === sizingSource ? measured?.ratio : undefined) ??
    (kind === 'video' ? '16 / 9' : '1 / 1');
  return (
    <div
      data-generation-state={
        active ? (pending ? 'generating' : 'revealing') : 'idle'
      }
      aria-busy={pending}
      style={{
        position: 'relative',
        width: '100%',
        ...(fill ? { height: '100%' } : active ? { aspectRatio: ratio } : {}),
        borderRadius: fill ? 'inherit' : 8,
        overflow: 'hidden',
      }}
    >
      <div
        ref={contentRef}
        style={{
          ...(fill || active ? { width: '100%', height: '100%' } : {}),
          ...(active
            ? { position: 'absolute', inset: 0, pointerEvents: 'none' }
            : {}),
        }}
        inert={active || undefined}
      >
        {children}
      </div>
      {active && (
        <div
          className="absolute inset-0"
          style={{ zIndex: 2, pointerEvents: 'none' }}
        >
          <LoadingFallback />
          <EffectBoundary key={version} pending={pending} onComplete={finish}>
            <GenerationEffect
              source={pending ? undefined : (resultSrc ?? undefined)}
              kind={kind}
              onComplete={revealComplete}
              onFallback={finish}
            />
          </EffectBoundary>
          <span className="sr-only" role="status">
            {pending ? 'Generating media' : 'Revealing generated media'}
          </span>
        </div>
      )}
    </div>
  );
}
