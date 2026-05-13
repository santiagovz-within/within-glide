'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';

interface MediaPreviewModalProps {
  url: string;
  type: 'image' | 'video';
  onClose: () => void;
}

export function MediaPreviewModal({ url, type, onClose }: MediaPreviewModalProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center nodrag nowheel nopan"
      style={{ zIndex: 9999, background: 'rgba(0,0,0,0.85)' }}
      onClick={onClose}
    >
      <button
        className="absolute top-4 right-4 flex items-center justify-center nodrag"
        style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,0.12)', color: '#fff' }}
        onClick={onClose}
      >
        <X size={18} />
      </button>
      <div
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: '90vw', maxHeight: '90vh' }}
      >
        {type === 'video' ? (
          <video
            src={url}
            controls
            autoPlay
            style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 12, display: 'block' }}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt="Preview"
            style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 12, display: 'block' }}
          />
        )}
      </div>
    </div>
  );
}
