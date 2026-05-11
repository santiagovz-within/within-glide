'use client';

import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  useReactFlow,
  Panel,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFlowStore } from '@/lib/stores/flowStore';
import { PromptNode } from './nodes/PromptNode';
import { ImageInputNode } from './nodes/ImageInputNode';
import { ImageGenNode } from './nodes/ImageGenNode';
import { VideoGenNode } from './nodes/VideoGenNode';
import { UpscaleNode } from './nodes/UpscaleNode';
import { OutputNode } from './nodes/OutputNode';
import { CustomEdge } from './edges/CustomEdge';
import { NodeToolbar } from './NodeToolbar';
import type { NodeType, NodeData } from '@/types';

const nodeTypes = {
  promptNode: PromptNode,
  imageInputNode: ImageInputNode,
  imageGenNode: ImageGenNode,
  videoGenNode: VideoGenNode,
  upscaleNode: UpscaleNode,
  outputNode: OutputNode,
};

const edgeTypes = {
  default: CustomEdge,
};

const DEFAULT_NODE_DATA: Record<NodeType, NodeData> = {
  promptNode: { prompt: '' },
  imageInputNode: {},
  imageGenNode: { model: 'flux-2-pro', aspectRatio: '1:1', resolution: '1K', numImages: 1, status: 'idle' },
  videoGenNode: { model: 'kling-3-pro', aspectRatio: '16:9', duration: 5, status: 'idle' },
  upscaleNode: { model: 'seedvr2', scaleFactor: 2, status: 'idle' },
  outputNode: {},
};

interface ContextMenu {
  x: number;
  y: number;
  canvasX: number;
  canvasY: number;
}

export function FlowCanvas() {
  const {
    nodes, edges,
    onNodesChange, onEdgesChange, onConnect,
    addNode, updateNodeData,
  } = useFlowStore();

  const { screenToFlowPosition } = useReactFlow();
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  // Listen for node data updates dispatched from child nodes
  useEffect(() => {
    function handleNodeUpdate(e: Event) {
      const { nodeId, data } = (e as CustomEvent).detail;
      updateNodeData(nodeId, data);
    }
    document.addEventListener('node:update', handleNodeUpdate);
    return () => document.removeEventListener('node:update', handleNodeUpdate);
  }, [updateNodeData]);

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const bounds = reactFlowWrapper.current?.getBoundingClientRect();
      if (!bounds) return;
      const canvasPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        canvasX: canvasPos.x,
        canvasY: canvasPos.y,
      });
    },
    [screenToFlowPosition]
  );

  function handleAddNode(type: NodeType) {
    if (!contextMenu) return;
    const newNode: Node<NodeData> = {
      id: `${type}-${Date.now()}`,
      type,
      position: { x: contextMenu.canvasX, y: contextMenu.canvasY },
      data: { ...DEFAULT_NODE_DATA[type] },
    };
    addNode(newNode);
  }

  // Pass through prompt from connected PromptNode to downstream nodes
  const onConnectHandler = useCallback(
    (connection: Parameters<typeof onConnect>[0]) => {
      onConnect(connection);
      // If connecting a prompt output to an image/video gen node, copy prompt value
      const sourceNode = nodes.find((n) => n.id === connection.source);
      if (
        sourceNode?.type === 'promptNode' &&
        connection.sourceHandle === 'prompt'
      ) {
        const promptData = sourceNode.data as { prompt?: string };
        updateNodeData(connection.target, { prompt: promptData.prompt ?? '' });
      }
    },
    [onConnect, nodes, updateNodeData]
  );

  return (
    <div ref={reactFlowWrapper} className="w-full h-full" onContextMenu={onContextMenu}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnectHandler}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ animated: true, type: 'default' }}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        deleteKeyCode="Delete"
        style={{ background: 'var(--color-bg-darkest)' }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="rgba(255,255,255,0.06)"
        />
        <Controls
          showInteractive={false}
          style={{
            background: 'var(--color-bg-elevated)',
            border: 'var(--border-default)',
          }}
        />
        <MiniMap
          nodeColor="var(--color-bg-surface)"
          maskColor="rgba(0,0,0,0.4)"
          style={{
            background: 'var(--color-bg-elevated)',
            border: 'var(--border-default)',
          }}
        />
        <Panel position="bottom-center">
          <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>
            Right-click canvas to add nodes · Delete key removes selected
          </p>
        </Panel>
      </ReactFlow>

      {contextMenu && (
        <NodeToolbar
          x={contextMenu.x}
          y={contextMenu.y}
          onAdd={handleAddNode}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
