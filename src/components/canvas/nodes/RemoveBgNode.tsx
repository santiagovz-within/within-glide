'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Scissors, Play, Download } from 'lucide-react';
import { useState } from 'react';
import { downloadFromUrl } from '@/lib/utils/download';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import type { RemoveBgNodeData, ImageInputNodeData, ImageGenNodeData, UpscaleNodeData, SelectNodeData, ModifyNodeData } from '@/types';
import { useFlowStore } from '@/lib/stores/flowStore';

const CHECKERBOARD: React.CSSProperties = {
  backgroundImage:
    'conic-gradient(#3a3a3a 90deg, #2a2a2a 90deg 180deg, #3a3a3a 180deg 270deg, #2a2a2a 270deg)',
  backgroundSize: '14px 14px',
};

export function RemoveBgNode({ data, selected, id }: NodeProps & { data: RemoveBgNodeData }) {
  const [isProcessing, setIsProcessing] = useState(false);

  const storeEdges = useFlowStore(state => state.edges);
  const storeNodes = useFlowStore(state => state.nodes);

  // Derive input image directly from connected source node (same pattern as UpscaleNode)
  const incomingEdge = storeEdges.find(e => e.target === id && e.targetHandle === 'image');
  const sourceNode = incomingEdge ? storeNodes.find(n => n.id === incomingEdge.source) : undefined;
  let inputImageUrl: string | undefined;
  if (sourceNode?.type === 'imageInputNode')  inputImageUrl = (sourceNode.data as ImageInputNodeData).imageUrl;
  else if (sourceNode?.type === 'imageGenNode')  inputImageUrl = (sourceNode.data as ImageGenNodeData).generatedImages?.[0];
  else if (sourceNode?.type === 'upscaleNode')   inputImageUrl = (sourceNode.data as UpscaleNodeData).outputImageUrl;
  else if (sourceNode?.type === 'modifyNode')    inputImageUrl = (sourceNode.data as ModifyNodeData).outputImageUrl;
  else if (sourceNode?.type === 'selectNode')    inputImageUrl = (sourceNode.data as SelectNodeData).selectedImageUrl;
  else if (sourceNode?.type === 'removeBgNode')  inputImageUrl = (sourceNode.data as RemoveBgNodeData).outputImageUrl;

  function updateData(updates: Partial<RemoveBgNodeData>) {
    document.dispatchEvent(new CustomEvent('node:update', {
      detail: { nodeId: id, data: updates },
    }));
  }

  async function handleRemove() {
    if (!inputImageUrl || isProcessing) return;
    setIsProcessing(true);
    updateData({ status: 'processing' });

    try {
      const res = await fetch('/api/fal/remove-background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: inputImageUrl, sourceType: 'canvas', nodeId: id }),
      });
      const result = await res.json();

      if (result.mediaUrls?.[0]) {
        updateData({ outputImageUrl: result.mediaUrls[0], status: 'completed' });
        document.dispatchEvent(new CustomEvent('node:image-propagate', {
          detail: { sourceNodeId: id, imageUrl: result.mediaUrls[0] },
        }));
      } else {
        updateData({ status: 'error' });
      }
    } catch {
      updateData({ status: 'error' });
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <NodeWrapper
      title="Remove Background"
      icon={<Scissors size={14} />}
      status={data.status}
      selected={selected}
      minWidth={280}
      accentColor={PORT_COLORS.image}
    >
      <TypedHandle type="target" position={Position.Left}  id="image" portType="image" />
      <TypedHandle type="source" position={Position.Right} id="image" portType="image" />

      {/* ── Preview ─────────────────────────────────────────────────────── */}
      {data.outputImageUrl ? (
        // Output on checkerboard so transparency is visible
        <div className="-mx-3 mb-3 overflow-hidden" style={CHECKERBOARD}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={data.outputImageUrl}
            alt="Background removed"
            className="w-full block nodrag"
            style={{ height: 'auto' }}
          />
        </div>
      ) : inputImageUrl ? (
        <div className="-mx-3 mb-3 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={inputImageUrl}
            alt="Input"
            className="w-full block nodrag"
            style={{ height: 'auto' }}
          />
        </div>
      ) : (
        <div
          className="flex items-center justify-center rounded-lg mb-3 text-xs"
          style={{
            height: 56,
            border: '1.5px dashed rgba(255,255,255,0.15)',
            color: 'var(--color-white-muted)',
          }}
        >
          Connect an image source
        </div>
      )}

      {/* ── Action button ─────────────────────────────────────────────── */}
      <button
        onClick={handleRemove}
        disabled={isProcessing || !inputImageUrl}
        className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-opacity disabled:opacity-40 nodrag"
        style={{ background: '#fff', color: '#000', borderRadius: 11 }}
      >
        <Play size={12} />
        {isProcessing ? 'Processing…' : 'Remove Background'}
      </button>

      {/* ── Download ──────────────────────────────────────────────────── */}
      {data.outputImageUrl && (
        <button
          onClick={() => downloadFromUrl(data.outputImageUrl!)}
          className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium mt-1.5 nodrag transition-opacity hover:opacity-80 active:opacity-60"
          style={{ background: 'var(--color-bg-surface)', color: 'var(--color-white-muted)', borderRadius: 11 }}
        >
          <Download size={12} />
          Download PNG
        </button>
      )}
    </NodeWrapper>
  );
}
