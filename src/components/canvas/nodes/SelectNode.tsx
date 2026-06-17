'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Pointer, Download } from 'lucide-react';
import { useEffect } from 'react';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
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

  // Keep selectedImageUrl in store in sync and propagate to downstream nodes
  useEffect(() => {
    if (currentUrl !== data.selectedImageUrl) {
      document.dispatchEvent(new CustomEvent('node:update', {
        detail: { nodeId: id, data: { selectedImageUrl: currentUrl } },
      }));
    }
    // Notify downstream nodes (e.g. imageGenNode reference inputs)
    document.dispatchEvent(new CustomEvent('node:image-propagate', {
      detail: { sourceNodeId: id, imageUrl: currentUrl ?? null },
    }));
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
      titlePosition="outside"
      footer={currentUrl ? (
        <button
          onClick={() => downloadFromUrl(currentUrl)}
          className="w-full flex items-center justify-center gap-1.5 py-3 text-xs font-medium nodrag transition-opacity hover:opacity-80 active:opacity-60"
          style={{ background: 'var(--color-bg-surface)', color: 'var(--color-white-muted)', borderRadius: 11 }}
        >
          <Download size={12} />
          Download
        </button>
      ) : undefined}
    >
      <TypedHandle
        type="target"
        position={Position.Left}
        id="input"
        portType="image"
        connected={storeEdges.some(e => e.target === id && e.targetHandle === 'input')}
      />
      <TypedHandle
        type="source"
        position={Position.Right}
        id="image"
        portType="image"
        connected={storeEdges.some(e => e.source === id && e.sourceHandle === 'image')}
      />

      {currentUrl ? (
        <>
          {/* Thumbnail strip — only shown when source has multiple images */}
          {availableImages.length > 1 && (
            <div className="flex gap-1.5 mb-2 nodrag" style={{ padding: '3px', overflowX: 'auto' }}>
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
                    outline: selectedIndex === i ? '2px solid #a855f7' : '2px solid transparent',
                    outlineOffset: 1,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </button>
              ))}
            </div>
          )}

          {/* Selected media preview */}
          <div
            className="overflow-hidden"
            style={{ margin: '0 -18px -18px -18px', overflow: 'hidden' }}
          >
            {mediaType === 'video' ? (
              <video src={currentUrl} controls className="w-full block" style={{ height: 'auto' }} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={currentUrl} alt="Selected" className="w-full block" draggable={false} style={{ height: 'auto' }} />
            )}
          </div>
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
