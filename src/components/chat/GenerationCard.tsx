'use client';

import { Download, Expand, Play } from 'lucide-react';
import { useState } from 'react';
import type { Generation } from '@/types';

interface GenerationCardProps {
  generation: Generation;
  onClick?: () => void;
}

export function GenerationCard({ generation, onClick }: GenerationCardProps) {
  const [hover, setHover] = useState(false);
  const isVideo = generation.media_type === 'video';

  return (
    <div
      className="relative rounded-xl overflow-hidden cursor-pointer group"
      style={{
        aspectRatio: '1',
        background: 'var(--color-bg-surface)',
        border: 'var(--border-default)',
      }}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {isVideo ? (
        <video
          src={generation.media_url}
          className="w-full h-full object-cover"
          preload="metadata"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={generation.media_url}
          alt={generation.prompt ?? ''}
          className="w-full h-full object-cover"
        />
      )}

      {isVideo && !hover && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.5)' }}
          >
            <Play size={16} style={{ color: '#fff' }} />
          </div>
        </div>
      )}

      {hover && (
        <div className="absolute inset-0 flex items-end justify-end p-2 gap-1.5" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <a
            href={generation.media_url}
            download
            className="p-1.5 rounded-lg transition-colors hover:bg-white/20"
            style={{ background: 'rgba(0,0,0,0.4)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <Download size={12} style={{ color: '#fff' }} />
          </a>
          <button
            className="p-1.5 rounded-lg transition-colors hover:bg-white/20"
            style={{ background: 'rgba(0,0,0,0.4)' }}
            onClick={onClick}
          >
            <Expand size={12} style={{ color: '#fff' }} />
          </button>
        </div>
      )}

      {generation.status === 'processing' && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="text-center">
            <div
              className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin mx-auto mb-2"
              style={{ borderColor: 'var(--color-accent)', borderTopColor: 'transparent' }}
            />
            <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>Generating...</p>
          </div>
        </div>
      )}
    </div>
  );
}
