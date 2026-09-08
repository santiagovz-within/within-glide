'use client';

import { Copy, Download, Heart, Loader2, Play, AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Generation } from '@/types';
import { resolveMediaUrl } from '@/lib/utils/mediaUtils';
import { downloadFromUrl } from '@/lib/utils/download';
import { useGenerationLikesStore } from '@/lib/stores/generationLikesStore';
import styles from './ImageVideo.module.css';

interface GenerationCardProps {
  generation: Generation;
  onClick: () => void;
  onCopyPrompt: (prompt: string) => void;
}

function getAspectRatio(gen: Generation): string {
  if (gen.width && gen.height) return `${gen.width} / ${gen.height}`;
  const ar = gen.parameters?.aspectRatio;
  if (typeof ar === 'string') {
    const [width, height] = ar.split(':').map(Number);
    if (width > 0 && height > 0) return `${width} / ${height}`;
  }
  return '1 / 1';
}

export function GenerationCard({ generation, onClick, onCopyPrompt }: GenerationCardProps) {
  const [resolvedUrl, setResolvedUrl] = useState('');
  const liked = useGenerationLikesStore(state => state.likedIds.includes(generation.id));
  const toggleLike = useGenerationLikesStore(state => state.toggleLike);
  const isVideo = generation.media_type === 'video';
  const pending = generation.status === 'pending' || generation.status === 'processing';
  const failed = generation.status === 'failed';

  useEffect(() => {
    let cancelled = false;
    if (!pending && !failed && generation.media_url) {
      resolveMediaUrl(generation.media_url).then(url => { if (!cancelled) setResolvedUrl(url); });
    }
    return () => { cancelled = true; };
  }, [generation.media_url, pending, failed]);

  return (
    <article className={styles.tile} style={{ aspectRatio: getAspectRatio(generation) }}>
      {pending || failed ? (
        <div className={styles.status} role="status">
          {failed ? <AlertTriangle size={20} style={{ color: 'var(--color-error)' }} /> : <Loader2 size={20} className="animate-spin" />}
          <span>{failed ? 'Generation failed' : 'Generating'}</span>
          {failed && generation.error_message && <span>{generation.error_message}</span>}
        </div>
      ) : (
        <>
          <button className={styles.openTile} onClick={onClick} aria-label={`Open ${generation.media_type}: ${generation.prompt || generation.model}`}>
            {resolvedUrl && (isVideo ? (
              <video src={resolvedUrl} preload="metadata" muted playsInline />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={resolvedUrl} alt={generation.prompt ?? ''} loading="lazy" />
            ))}
          </button>
          {isVideo && <Play size={30} className={styles.play} />}
          <div className={styles.tileActions}>
            <button onClick={() => toggleLike(generation.id)} aria-pressed={liked} title={liked ? 'Unlike' : 'Like'} aria-label={liked ? 'Unlike' : 'Like'}><Heart size={15} fill={liked ? 'currentColor' : 'none'} /></button>
            <button onClick={() => downloadFromUrl(resolvedUrl, `canvasflow-${generation.id.slice(0, 8)}`)} disabled={!resolvedUrl} title="Download" aria-label="Download"><Download size={15} /></button>
            <button onClick={() => onCopyPrompt(generation.prompt ?? '')} disabled={!generation.prompt} title="Copy prompt" aria-label="Copy prompt"><Copy size={15} /></button>
          </div>
        </>
      )}
    </article>
  );
}
