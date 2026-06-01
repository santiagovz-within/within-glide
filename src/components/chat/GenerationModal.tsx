'use client';

import { X, Download } from 'lucide-react';
import type { Generation } from '@/types';
import { formatDate } from '@/lib/utils/date';
import { ProgressiveImage } from '@/components/ui/ProgressiveImage';

interface Props {
  generation: Generation;
  onClose: () => void;
}

export function GenerationModal({ generation, onClose }: Props) {
  const isVideo = generation.media_type === 'video';

  async function handleDownload(e: React.MouseEvent) {
    e.stopPropagation();
    const ext = isVideo ? 'mp4' : 'png';
    const filename = `canvasflow-${generation.id.slice(0, 8)}.${ext}`;
    try {
      const res = await fetch(generation.media_url);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.open(generation.media_url, '_blank');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-8"
      style={{ background: 'rgba(0,0,0,0.8)' }}
      onClick={onClose}
    >
      <div
        className="relative flex gap-6 max-w-4xl w-full rounded-2xl overflow-hidden"
        style={{
          background: 'var(--color-bg-elevated)',
          border: 'var(--border-default)',
          boxShadow: 'var(--shadow-modal)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Media */}
        <div className="flex-1 min-w-0 flex items-center justify-center" style={{ maxWidth: '60%' }}>
          {isVideo ? (
            <video
              src={generation.media_url}
              controls
              className="w-full h-full object-contain"
              style={{ maxHeight: '70vh' }}
            />
          ) : (
            <ProgressiveImage
              src={generation.media_url}
              alt=""
              className="w-full h-full object-contain"
              style={{ maxHeight: '70vh' }}
            />
          )}
        </div>

        {/* Metadata */}
        <div className="w-72 flex-shrink-0 p-6 flex flex-col" style={{ borderLeft: 'var(--border-default)' }}>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-white)' }}>Details</h2>
            <button onClick={onClose} className="p-1 rounded transition-opacity hover:opacity-60">
              <X size={16} style={{ color: 'var(--color-white-muted)' }} />
            </button>
          </div>

          <div className="space-y-4 flex-1">
            <MetaRow label="Model" value={generation.model} />
            <MetaRow label="Type" value={generation.media_type} />
            <MetaRow label="Date" value={formatDate(generation.created_at)} />
            {generation.prompt && (
              <div>
                <p className="text-xs font-medium mb-1" style={{ color: 'var(--color-white-muted)' }}>Prompt</p>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--color-white)' }}>{generation.prompt}</p>
              </div>
            )}
            {(generation.width && generation.height) && (
              <MetaRow label="Size" value={`${generation.width} × ${generation.height}`} />
            )}
          </div>

          <button
            onClick={handleDownload}
            className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-opacity hover:opacity-80 mt-6"
            style={{ background: 'var(--color-accent)', color: '#fff' }}
          >
            <Download size={12} />
            Download
          </button>
        </div>
      </div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium mb-0.5" style={{ color: 'var(--color-white-muted)' }}>{label}</p>
      <p className="text-xs capitalize" style={{ color: 'var(--color-white)' }}>{value}</p>
    </div>
  );
}
