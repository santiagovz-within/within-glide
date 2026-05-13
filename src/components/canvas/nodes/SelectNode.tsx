'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Pointer, Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import { MediaPreviewModal } from './MediaPreviewModal';
import { useFlowStore } from '@/lib/stores/flowStore';
import { downloadFromUrl } from '@/lib/utils/download';
import type {
  SelectNodeData,
  ImageGenNodeData,
  ImageInputNodeData,
  UpscaleNodeData,
  ModifyNodeData,
  VideoGenNodeData,
} from '@/types';

export function SelectNode({ data, selected, id }: NodeProps & { data: SelectNodeData }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const storeEdges = useFlowStore(state => state.edges);
  const storeNodes = useFlowStore(state => state.nodes);

  const incomingEdge = storeEdges.find(e => e.target === id && e.targetHandle === 'input');
  const sourceNode = incomingEdge ? storeNodes.find(n => n.id === incomingEdge.source) : undefined;

  let availableImages: string[] = [];
  let videoUrl: string | undefined;

  if (sourceNode?.type === 'imageGenNode') {
    availableImages = (sourceNode.data as ImageGenNodeData).generatedImages ?? [];
  } else if (sourceNode?.type === 'imageInputNode') {
    const url = (sourceNode.data as ImageInputNodeData).imageUrl;
    if (url) availableImages = [url];
  } else if (sourceNode?.type === 'upscaleNode') {
    const url = (sourceNode.data as UpscaleNodeData).outputImageUrl;
    if (url) availableImages = [url];
  } else if (sourceNode?.type === 'modifyNode') {
    const url = (sourceNode.data as ModifyNodeData).outputImageUrl;
    if (url) availableImages = [url];
  } else if (sourceNode?.type === 'videoGenNode') {
    videoUrl = (sourceNode.data as VideoGenNodeData).videoUrl;
  }

  const selectedIndex = Math.min(data.selectedIndex ?? 0, Math.max(availableImages.length - 1, 0));
  const currentUrl = availableImages[selectedIndex] ?? videoUrl;
  const mediaType: 'image' | 'video' = videoUrl ? 'video' : 'image';

  // Keep selectedImageUrl in store in sync so downstream nodes can read it
  useEffect(() => {
    if (currentUrl !== data.selectedImageUrl) {
      document.dispatchEvent(new CustomEvent('node:update', {
        detail: { nodeId: id, data: { selectedImageUrl: currentUrl } },
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUrl]);

  function selectImage(i: number) {
    document.dispatchEvent(new CustomEvent('node:update', {
      detail: { nodeId: id, data: { selectedIndex: i, selectedImageUrl: availableImages[i] } },
    }));
  }

  return (
    <NodeWrapper
      title="Select"
      icon={<Pointer size={14} />}
      selected={selected}
      minWidth={240}
      accentColor={PORT_COLORS.image}
    >
      <TypedHandle type="target" position={Position.Left} id="input" portType="image" />
      <TypedHandle type="source" position={Position.Right} id="image" portType="image" />

      {currentUrl ? (
        <>
          {/* Thumbnail strip — only shown when source has multiple images */}
          {availableImages.length > 1 && (
            <div className="flex gap-1.5 mb-2 overflow-x-auto nodrag">
              {availableImages.map((url, i) => (
                <button
                  key={i}
                  onClick={() => selectImage(i)}
                  className="shrink-0 nodrag"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 6,
                    padding: 0,
                    overflow: 'hidden',
                    outline: selectedIndex === i ? '2px solid var(--color-accent)' : '2px solid transparent',
                    outlineOffset: 1,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </button>
              ))}
            </div>
          )}

          {/* Selected media preview */}
          <div
            className="-mx-3 overflow-hidden cursor-pointer nodrag"
            style={{ borderRadius: 0 }}
            onClick={() => setPreviewOpen(true)}
          >
            {mediaType === 'video' ? (
              <video src={currentUrl} controls className="w-full block" style={{ height: 'auto' }} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={currentUrl} alt="Selected" className="w-full block" style={{ height: 'auto' }} />
            )}
          </div>

          <button
            onClick={() => downloadFromUrl(currentUrl)}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium mt-3 nodrag transition-opacity hover:opacity-80 active:opacity-60"
            style={{ background: 'var(--color-bg-surface)', color: 'var(--color-white-muted)', borderRadius: 11 }}
          >
            <Download size={12} />
            Download
          </button>

          {previewOpen && (
            <MediaPreviewModal url={currentUrl} type={mediaType} onClose={() => setPreviewOpen(false)} />
          )}
        </>
      ) : (
        <div
          className="flex items-center justify-center"
          style={{ height: 80, border: '1.5px dashed rgba(168,85,247,0.2)', borderRadius: 8 }}
        >
          <p className="text-xs text-center" style={{ color: 'var(--color-white-muted)' }}>
            Connect an image or video node
          </p>
        </div>
      )}
    </NodeWrapper>
  );
}
