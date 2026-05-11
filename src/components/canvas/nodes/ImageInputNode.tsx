'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ImageIcon, Upload, X } from 'lucide-react';
import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { NodeWrapper } from './NodeWrapper';
import type { ImageInputNodeData } from '@/types';
import { ACCEPTED_IMAGE_TYPES, MAX_UPLOAD_SIZE_BYTES } from '@/lib/utils/constants';

export function ImageInputNode({ data, selected, id }: NodeProps & { data: ImageInputNodeData }) {
  const onDrop = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;

      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const { url } = await res.json();

      if (url) {
        const event = new CustomEvent('node:update', {
          detail: { nodeId: id, data: { imageUrl: url } },
        });
        document.dispatchEvent(event);
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
    const event = new CustomEvent('node:update', {
      detail: { nodeId: id, data: { imageUrl: undefined } },
    });
    document.dispatchEvent(event);
  }

  return (
    <NodeWrapper title="Image Input" icon={<ImageIcon size={14} />} selected={selected} minWidth={240}>
      {data.imageUrl ? (
        <div className="relative rounded-lg overflow-hidden" style={{ height: 140 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={data.imageUrl} alt="Input" className="w-full h-full object-cover" />
          <button
            className="absolute top-1 right-1 p-0.5 rounded-full nodrag"
            style={{ background: 'rgba(0,0,0,0.6)' }}
            onClick={clearImage}
          >
            <X size={12} style={{ color: 'var(--color-white)' }} />
          </button>
        </div>
      ) : (
        <div
          {...getRootProps()}
          className="flex flex-col items-center justify-center gap-2 rounded-lg cursor-pointer transition-colors nodrag"
          style={{
            height: 100,
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
      )}

      <Handle
        type="source"
        position={Position.Right}
        id="image"
        style={{
          background: 'var(--color-accent)',
          border: '2px solid var(--color-bg-elevated)',
          width: 10,
          height: 10,
        }}
      />
    </NodeWrapper>
  );
}
