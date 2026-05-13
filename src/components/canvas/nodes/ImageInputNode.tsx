'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Image, Upload, X, RefreshCw, Layout } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import type { ImageInputNodeData } from '@/types';
import { ACCEPTED_IMAGE_TYPES, MAX_UPLOAD_SIZE_BYTES } from '@/lib/utils/constants';
import { createClient } from '@/lib/supabase/client';

interface GalleryImage {
  id: string;
  media_url: string;
  prompt: string | null;
  model: string;
}

function GalleryPicker({ onSelect, onClose }: { onSelect: (url: string) => void; onClose: () => void }) {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data } = await supabase
        .from('generations')
        .select('id, media_url, prompt, model')
        .eq('user_id', user.id)
        .eq('status', 'completed')
        .eq('media_type', 'image')
        .order('created_at', { ascending: false })
        .limit(60);
      setImages(data ?? []);
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={onClose}
    >
      <div
        className="relative rounded-xl overflow-hidden flex flex-col"
        style={{
          width: 560,
          maxHeight: '80vh',
          background: 'var(--color-bg-elevated)',
          border: 'var(--border-default)',
          boxShadow: 'var(--shadow-modal)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: 'var(--border-default)' }}>
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-white-muted)' }}>
            Select from Gallery
          </p>
          <button onClick={onClose} className="p-0.5 rounded hover:opacity-60">
            <X size={14} style={{ color: 'var(--color-white-muted)' }} />
          </button>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <RefreshCw size={20} className="animate-spin" style={{ color: 'var(--color-white-muted)' }} />
            </div>
          ) : images.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
              <Image size={28} style={{ color: 'var(--color-white-muted)', opacity: 0.4 }} />
              <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>No images in gallery yet</p>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {images.map((img) => (
                <button
                  key={img.id}
                  className="rounded-lg overflow-hidden transition-all hover:opacity-90 hover:ring-2 nodrag"
                  style={{ aspectRatio: '1', background: 'var(--color-bg-surface)', '--tw-ring-color': 'var(--color-accent)' } as React.CSSProperties}
                  onClick={() => onSelect(img.media_url)}
                  title={img.prompt ?? img.model}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.media_url} alt={img.prompt ?? ''} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ImageInputNode({ data, selected, id }: NodeProps & { data: ImageInputNodeData }) {
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showGallery, setShowGallery] = useState(false);

  const onDrop = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;

      const localPreview = URL.createObjectURL(file);
      setPreviewUrl(localPreview);
      setUploading(true);

      const formData = new FormData();
      formData.append('file', file);

      try {
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        const { url } = await res.json();

        if (url) {
          document.dispatchEvent(new CustomEvent('node:update', {
            detail: { nodeId: id, data: { imageUrl: url } },
          }));
          document.dispatchEvent(new CustomEvent('node:image-propagate', {
            detail: { sourceNodeId: id, imageUrl: url },
          }));
        }
      } finally {
        setUploading(false);
        URL.revokeObjectURL(localPreview);
        setPreviewUrl(null);
      }
    },
    [id]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_IMAGE_TYPES,
    maxSize: MAX_UPLOAD_SIZE_BYTES,
    maxFiles: 1,
  });

  function clearImage() {
    document.dispatchEvent(new CustomEvent('node:update', {
      detail: { nodeId: id, data: { imageUrl: undefined, naturalWidth: undefined, naturalHeight: undefined } },
    }));
    document.dispatchEvent(new CustomEvent('node:image-propagate', {
      detail: { sourceNodeId: id, imageUrl: null },
    }));
  }

  function handleImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    document.dispatchEvent(new CustomEvent('node:update', {
      detail: { nodeId: id, data: { naturalWidth, naturalHeight } },
    }));
  }

  function handleGallerySelect(url: string) {
    setShowGallery(false);
    document.dispatchEvent(new CustomEvent('node:update', {
      detail: { nodeId: id, data: { imageUrl: url, naturalWidth: undefined, naturalHeight: undefined } },
    }));
    document.dispatchEvent(new CustomEvent('node:image-propagate', {
      detail: { sourceNodeId: id, imageUrl: url },
    }));
  }

  return (
    <NodeWrapper title="Image Input" icon={<Image size={14} />} selected={selected} minWidth={280} accentColor={PORT_COLORS.image}>
      {uploading && previewUrl ? (
        <div className="relative -m-3 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Uploading"
            className="w-full block nodrag"
            style={{ height: 'auto', filter: 'blur(6px)', transform: 'scale(1.05)' }}
          />
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.35)' }}
          >
            <RefreshCw size={28} className="animate-spin" style={{ color: '#fff' }} />
          </div>
        </div>
      ) : data.imageUrl ? (
        <div className="relative -m-3 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={data.imageUrl}
            alt="Input"
            className="w-full block nodrag"
            style={{ height: 'auto' }}
            onLoad={handleImageLoad}
          />
          <button
            className="absolute top-1 right-1 p-0.5 rounded-full nodrag"
            style={{ background: 'rgba(0,0,0,0.6)' }}
            onClick={clearImage}
          >
            <X size={12} style={{ color: 'var(--color-white)' }} />
          </button>
        </div>
      ) : (
        <>
          <div
            {...getRootProps()}
            className="flex flex-col items-center justify-center gap-2 rounded-lg cursor-pointer transition-colors nodrag"
            style={{
              height: 90,
              border: isDragActive
                ? '1.5px dashed var(--color-accent)'
                : '1.5px dashed rgba(255,255,255,0.2)',
              background: isDragActive ? 'var(--color-accent-glow)' : 'transparent',
            }}
          >
            <input {...getInputProps()} />
            <Upload size={18} style={{ color: 'var(--color-white-muted)' }} />
            <p className="text-xs text-center" style={{ color: 'var(--color-white-muted)' }}>
              {isDragActive ? 'Drop image here' : 'Drop or click to upload'}
            </p>
          </div>

          <button
            onClick={() => setShowGallery(true)}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium mt-2 transition-opacity hover:opacity-80 nodrag"
            style={{
              background: 'var(--color-bg-surface)',
              border: 'var(--border-default)',
              color: 'var(--color-white-muted)',
            }}
          >
            <Layout size={12} />
            Browse Gallery
          </button>
        </>
      )}

      <TypedHandle
        type="source"
        position={Position.Right}
        id="image"
        portType="image"
      />

      {showGallery && (
        <GalleryPicker onSelect={handleGallerySelect} onClose={() => setShowGallery(false)} />
      )}
    </NodeWrapper>
  );
}
