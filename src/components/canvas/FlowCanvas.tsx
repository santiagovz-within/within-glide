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
  type Connection,
  type IsValidConnection,
  type Edge,
  type EdgeChange,
  type OnConnectStart,
  type FinalConnectionState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFlowStore } from '@/lib/stores/flowStore';
import { useThemeStore } from '@/lib/stores/themeStore';
import { PromptNode } from './nodes/PromptNode';
import { ImageInputNode } from './nodes/ImageInputNode';
import { ImageToPromptNode } from './nodes/ImageToPromptNode';
import { ImageGenNode } from './nodes/ImageGenNode';
import { VideoGenNode } from './nodes/VideoGenNode';
import { UpscaleNode } from './nodes/UpscaleNode';
import { ModifyNode } from './nodes/ModifyNode';
import { SelectNode } from './nodes/SelectNode';
import { OutputNode } from './nodes/OutputNode';
import { GalleryOutputNode } from './nodes/GalleryOutputNode';
import { VideoToGifNode } from './nodes/VideoToGifNode';
import { RemoveBgNode } from './nodes/RemoveBgNode';
import { VideoInputNode } from './nodes/VideoInputNode';
import { MediaInputNode } from './nodes/MediaInputNode';
import { UpscaleMediaNode } from './nodes/UpscaleMediaNode';
import { VideoUpscaleNode } from './nodes/VideoUpscaleNode';
import { GroupNode } from './nodes/GroupNode';
import { CustomEdge } from './edges/CustomEdge';
import { NodeToolbar } from './NodeToolbar';
import { PORT_TYPE_MAP } from './nodes/TypedHandle';
import type { NodeType, NodeData, ImageGenNodeData, UpscaleNodeData, ModifyNodeData, SelectNodeData, ImageInputNodeData, ImageToPromptNodeData, VideoGenNodeData, RemoveBgNodeData, MediaInputNodeData, UpscaleMediaNodeData } from '@/types';
import { MODELS } from '@/lib/api/models';
import { processImageFile } from '@/lib/utils/imageProcessing';
import { uploadImageToStorage } from '@/lib/utils/uploadImage';
import { setPendingFile } from '@/lib/utils/pendingFiles';

const nodeTypes = {
  promptNode: PromptNode,
  imageInputNode: ImageInputNode,
  imageToPromptNode: ImageToPromptNode,
  imageGenNode: ImageGenNode,
  videoGenNode: VideoGenNode,
  upscaleNode: UpscaleNode,
  modifyNode: ModifyNode,
  selectNode: SelectNode,
  outputNode: OutputNode,
  galleryOutputNode: GalleryOutputNode,
  videoToGifNode: VideoToGifNode,
  removeBgNode: RemoveBgNode,
  videoInputNode: VideoInputNode,
  mediaInputNode: MediaInputNode,
  upscaleMediaNode: UpscaleMediaNode,
  videoUpscaleNode: VideoUpscaleNode,
  groupNode: GroupNode,
};

const edgeTypes = {
  default: CustomEdge,
};

const DEFAULT_NODE_DATA: Record<NodeType, NodeData> = {
  promptNode:         { prompt: '' },
  imageInputNode:     {},
  imageToPromptNode:  { status: 'idle' },
  imageGenNode:       { model: 'nano-banana-2', aspectRatio: '1:1', resolution: '1K', numImages: 1, status: 'idle', inputImageUrls: [], imagePortCount: 0 },
  videoGenNode:       { model: 'kling-3-pro', aspectRatio: '16:9', duration: 5, status: 'idle' },
  upscaleNode:        { model: 'seedvr2', scaleFactor: 2, status: 'idle' },
  modifyNode:         { model: 'nano-banana-2', aspectRatio: '1:1', resolution: '1K', status: 'idle' },
  selectNode:         {},
  outputNode:         {},
  galleryOutputNode:  {},
  videoToGifNode:     { fps: 12, outputWidth: 480, startTime: 0, duration: 10, ditherLevel: 4 },
  removeBgNode:       { status: 'idle' },
  videoInputNode:     {},
  mediaInputNode:     {},
  upscaleMediaNode:   { model: 'seedvr2', scaleFactor: 2, upscaleFactor: 2, status: 'idle' },
  videoUpscaleNode:   { upscaleFactor: 2, status: 'idle' },
  groupNode:          { label: 'Group', color: 'Blue' },
};

interface ContextMenu { x: number; y: number; canvasX: number; canvasY: number; }

// Fields that are derived from edges or represent generation output — must be
// stripped when pasting so a duplicated node starts in a blank state.
const PASTE_CLEAR_FIELDS = new Set([
  'outputImageUrl', 'outputVideoUrl',
  'inputImageUrl',
  'generatedImages',
  'startFrameUrl', 'endFrameUrl',
  'generatedPrompt',
  'selectedImageUrl',
  'gifUrl',
  'promptConnected',
]);
// Input nodes own their media directly (user-uploaded) — keep it on paste.
const INPUT_NODE_TYPES = new Set(['imageInputNode', 'videoInputNode', 'mediaInputNode', 'promptNode']);

function pasteCleanData(nodeType: string | undefined, data: NodeData): NodeData {
  if (nodeType && INPUT_NODE_TYPES.has(nodeType)) return { ...data };
  const d = { ...data } as Record<string, unknown>;
  for (const f of PASTE_CLEAR_FIELDS) delete d[f];
  // Clear video that arrives via connection (not user-uploaded)
  if (nodeType !== 'videoInputNode' && nodeType !== 'mediaInputNode') delete d.videoUrl;
  // Reset array input ports
  if ('inputImageUrls' in d) d.inputImageUrls = [];
  if ('imagePortCount' in d) d.imagePortCount = 0;
  // Reset processing status
  if ('status' in d) d.status = 'idle';
  return d as NodeData;
}

function InvalidConnectionToast({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      className="absolute bottom-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg text-xs font-medium pointer-events-none"
      style={{ background: 'var(--color-error)', color: '#fff', boxShadow: 'var(--shadow-node)' }}
    >
      Incompatible port types — check the connector icons
    </div>
  );
}

interface FlowCanvasProps {
  isTestUser?: boolean;
}

export function FlowCanvas({ isTestUser = false }: FlowCanvasProps) {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, addNode, updateNodeData, setNodes, setEdges } = useFlowStore();
  const theme = useThemeStore((s) => s.theme);
  const allowedTypes = isTestUser ? (['mediaInputNode', 'videoToGifNode'] as import('@/types').NodeType[]) : undefined;
  const { screenToFlowPosition } = useReactFlow();
  const [contextMenu, setContextMenu]   = useState<ContextMenu | null>(null);
  const [invalidToast, setInvalidToast] = useState(false);
  const [isDragOver, setIsDragOver]     = useState(false);
  const reactFlowWrapper                = useRef<HTMLDivElement>(null);
  const invalidToastTimer               = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clipboardRef                    = useRef<{ nodes: Node<NodeData>[]; edges: Edge[]; incomingEdges: Edge[] } | null>(null);
  const undoStack                       = useRef<{ nodes: Node<NodeData>[]; edges: Edge[] }[]>([]);
  const MAX_UNDO                        = 30;
  const nodesRef                        = useRef(nodes);
  const edgesRef                        = useRef(edges);
  const pendingConnectionRef            = useRef<{ nodeId: string; handleId: string | null; handleType: string | null } | null>(null);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);

  // Listen for node data updates from child components
  useEffect(() => {
    function handleNodeUpdate(e: Event) {
      const { nodeId, data } = (e as CustomEvent).detail;
      updateNodeData(nodeId, data);
    }
    document.addEventListener('node:update', handleNodeUpdate);
    return () => document.removeEventListener('node:update', handleNodeUpdate);
  }, [updateNodeData]);

  // Live prompt propagation
  useEffect(() => {
    function handlePromptPropagate(e: Event) {
      const { sourceNodeId, prompt } = (e as CustomEvent).detail as { sourceNodeId: string; prompt: string };
      const connectedEdges = edges.filter(
        (edge) => edge.source === sourceNodeId && edge.sourceHandle === 'prompt'
      );
      for (const edge of connectedEdges) {
        updateNodeData(edge.target, { prompt });
      }
    }
    document.addEventListener('node:prompt-propagate', handlePromptPropagate);
    return () => document.removeEventListener('node:prompt-propagate', handlePromptPropagate);
  }, [edges, updateNodeData]);

  // ── Group selected nodes (Ctrl/Cmd+G) ───────────────────────────────────
  const groupSelectedNodes = useCallback(() => {
    const selectedNodes = nodesRef.current.filter((n) => n.selected && !n.parentId && n.type !== 'groupNode');
    if (selectedNodes.length < 2) return;

    const PADDING = 40;
    const DEFAULT_W = 300;
    const DEFAULT_H = 150;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of selectedNodes) {
      const w = (node.measured?.width as number | undefined) ?? DEFAULT_W;
      const h = (node.measured?.height as number | undefined) ?? DEFAULT_H;
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + w);
      maxY = Math.max(maxY, node.position.y + h);
    }

    const groupX = minX - PADDING;
    const groupY = minY - PADDING;
    const groupW = maxX - minX + PADDING * 2;
    const groupH = maxY - minY + PADDING * 2;

    const groupId = `groupNode-${Date.now()}`;

    const newGroupNode: Node<NodeData> = {
      id: groupId,
      type: 'groupNode',
      position: { x: groupX, y: groupY },
      style: { width: groupW, height: groupH },
      data: { label: 'Group', color: 'Blue' },
      selected: false,
    };

    const childIds = new Set(selectedNodes.map((n) => n.id));
    const updatedExisting = nodesRef.current.map((node) => {
      if (!childIds.has(node.id)) return node;
      return {
        ...node,
        parentId: groupId,
        position: { x: node.position.x - groupX, y: node.position.y - groupY },
        selected: false,
      };
    });

    // Group node must come first (renders behind children)
    const others   = updatedExisting.filter((n) => !childIds.has(n.id));
    const children = updatedExisting.filter((n) => childIds.has(n.id));
    setNodes([newGroupNode, ...others, ...children]);
  }, [setNodes]);

  // ── Copy / Paste / Delete keyboard shortcuts ─────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if ((e.key === 'Delete' || e.key === 'Backspace') && !inInput) {
        const selectedNodeIds = new Set(nodesRef.current.filter((n) => n.selected).map((n) => n.id));
        const hasSelectedEdges = edgesRef.current.some((e) => e.selected);
        if (selectedNodeIds.size > 0 || hasSelectedEdges) {
          // Snapshot before destructive action so Ctrl+Z can restore it
          undoStack.current.push({ nodes: nodesRef.current, edges: edgesRef.current });
          if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();

          // Also remove children of deleted group nodes
          const allToRemove = new Set(selectedNodeIds);
          for (const n of nodesRef.current) {
            if (n.parentId && selectedNodeIds.has(n.parentId)) allToRemove.add(n.id);
          }

          // Compute per-edge downstream state clears for surviving target nodes.
          // We cannot call propagateImageToTarget here (stale closure / nodesRef race),
          // so we compute updates inline from fresh store state and merge into setNodes.
          const freshNodes = useFlowStore.getState().nodes;
          const freshNodeMap = new Map(freshNodes.map((n) => [n.id, n]));
          const edgesToRemove = edgesRef.current.filter(
            (edge) => edge.selected || allToRemove.has(edge.source) || allToRemove.has(edge.target)
          );
          const removedEdgeIds = new Set(edgesToRemove.map((ed) => ed.id));
          const nodeUpdates = new Map<string, Record<string, unknown>>();

          for (const edge of edgesToRemove) {
            if (allToRemove.has(edge.target)) continue; // target being deleted too
            const targetNode = freshNodeMap.get(edge.target);
            if (!targetNode) continue;
            const acc = nodeUpdates.get(edge.target) ?? {};
            const handle = edge.targetHandle ?? '';

            if (edge.sourceHandle === 'image') {
              const t = targetNode.type ?? '';
              if (t === 'upscaleNode' || t === 'modifyNode' || t === 'removeBgNode' || t === 'imageToPromptNode') {
                nodeUpdates.set(edge.target, { ...acc, inputImageUrl: undefined });
              } else if (t === 'videoGenNode') {
                if (handle === 'start_frame') nodeUpdates.set(edge.target, { ...acc, startFrameUrl: undefined });
                else if (handle === 'end_frame') nodeUpdates.set(edge.target, { ...acc, endFrameUrl: undefined });
              } else if (t === 'imageGenNode') {
                const currentData = targetNode.data as ImageGenNodeData;
                const urls = [...(currentData.inputImageUrls ?? [])];
                const idx = handle.startsWith('ref_') ? parseInt(handle.split('_')[1]) : 0;
                urls[idx] = '';
                const filled = urls.filter(Boolean).length;
                const maxRefs = MODELS[currentData.model as keyof typeof MODELS]?.maxReferenceImages ?? 14;
                nodeUpdates.set(edge.target, { ...acc, inputImageUrls: urls, imagePortCount: Math.min(filled + 1, maxRefs) });
              }
            }
            if (edge.sourceHandle === 'video' && (handle === 'video' || handle === 'video_in')) {
              nodeUpdates.set(edge.target, { ...acc, videoUrl: undefined });
            }
            if (edge.sourceHandle === 'prompt') {
              const stillHasPrompt = edgesRef.current.some(
                (e) => !removedEdgeIds.has(e.id) && e.target === edge.target && e.sourceHandle === 'prompt'
              );
              if (!stillHasPrompt) nodeUpdates.set(edge.target, { ...acc, promptConnected: false });
            }
          }

          setNodes(
            freshNodes
              .filter((n) => !allToRemove.has(n.id))
              .map((n) => {
                const upd = nodeUpdates.get(n.id);
                return upd ? { ...n, data: { ...n.data, ...upd } } : n;
              })
          );
          setEdges(edgesRef.current.filter(
            (edge) => !edge.selected && !allToRemove.has(edge.source) && !allToRemove.has(edge.target)
          ));
          e.preventDefault();
        }
        return;
      }

      const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
      const ctrlOrCmd = isMac ? e.metaKey : e.ctrlKey;
      if (!ctrlOrCmd) return;
      if (inInput) return;

      // Ctrl/Cmd + Z → undo last delete
      if (e.key === 'z' && !e.shiftKey) {
        const prev = undoStack.current.pop();
        if (prev) {
          setNodes(prev.nodes);
          setEdges(prev.edges);
        }
        e.preventDefault();
        return;
      }

      // Ctrl/Cmd + G → group
      if (e.key === 'g') {
        groupSelectedNodes();
        e.preventDefault();
        return;
      }

      if (e.key === 'c') {
        const selected = nodesRef.current.filter((n) => n.selected);
        if (selected.length === 0) return;
        const selectedIds = new Set(selected.map((n) => n.id));
        // Edges whose both ends are in the selection (copied as-is)
        const copiedEdges = edgesRef.current.filter(
          (edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target)
        );
        // Edges coming INTO selected nodes from non-selected sources — these
        // represent upstream connections that should re-attach on paste.
        const incomingEdges = edgesRef.current.filter(
          (edge) => !selectedIds.has(edge.source) && selectedIds.has(edge.target)
        );
        clipboardRef.current = { nodes: selected, edges: copiedEdges, incomingEdges };
        e.preventDefault();
      }

      if (e.key === 'v') {
        const cb = clipboardRef.current;
        if (!cb || cb.nodes.length === 0) return;
        const ts = Date.now();
        const idMap = new Map<string, string>();

        const newNodes: Node<NodeData>[] = cb.nodes.map((n, i) => {
          const newId = `${n.type}-${ts}-${i}`;
          idMap.set(n.id, newId);
          return { ...n, id: newId, position: { x: n.position.x + 50, y: n.position.y + 50 }, data: pasteCleanData(n.type, n.data), selected: true } as Node<NodeData>;
        });

        // Internal edges — both ends remapped to new IDs
        const internalEdges: Edge[] = cb.edges.map((edge, i) => ({
          ...edge,
          id: `edge-${ts}-${i}`,
          source: idMap.get(edge.source) ?? edge.source,
          target: idMap.get(edge.target) ?? edge.target,
          animated: false,
        }));

        // Incoming edges from non-copied nodes — only the target is remapped so
        // the pasted node stays connected to the same upstream source.
        const externalEdges: Edge[] = (cb.incomingEdges ?? []).map((edge, i) => ({
          ...edge,
          id: `edge-ext-${ts}-${i}`,
          target: idMap.get(edge.target) ?? edge.target,
          animated: false,
        }));

        // Reconstruct inputImageUrls / imagePortCount for pasted imageGenNodes.
        // pasteCleanData zeroes these out, but the edges are still present —
        // we replicate the same URL-extraction logic as onConnectHandler so
        // all ref_ ports show correctly without needing a propagation event.
        const allPastedEdges = [...internalEdges, ...externalEdges];
        for (const edge of allPastedEdges) {
          if (!edge.targetHandle?.startsWith('ref_')) continue;
          const tgtIdx = newNodes.findIndex((n) => n.id === edge.target);
          if (tgtIdx === -1) continue;

          const sourceNode = newNodes.find((n) => n.id === edge.source)
            ?? nodesRef.current.find((n) => n.id === edge.source);
          if (!sourceNode) continue;

          let imageUrl: string | undefined;
          if (sourceNode.type === 'imageInputNode')   imageUrl = (sourceNode.data as ImageInputNodeData).imageUrl;
          else if (sourceNode.type === 'mediaInputNode')   imageUrl = (sourceNode.data as MediaInputNodeData).imageUrl;
          else if (sourceNode.type === 'upscaleMediaNode') imageUrl = (sourceNode.data as UpscaleMediaNodeData).outputImageUrl;
          else if (sourceNode.type === 'imageGenNode') imageUrl = (sourceNode.data as ImageGenNodeData).generatedImages?.[0];
          else if (sourceNode.type === 'upscaleNode')  imageUrl = (sourceNode.data as UpscaleNodeData).outputImageUrl;
          else if (sourceNode.type === 'modifyNode')   imageUrl = (sourceNode.data as ModifyNodeData).outputImageUrl;
          else if (sourceNode.type === 'selectNode')   imageUrl = (sourceNode.data as SelectNodeData).selectedImageUrl;
          else if (sourceNode.type === 'removeBgNode') imageUrl = (sourceNode.data as RemoveBgNodeData).outputImageUrl;
          if (!imageUrl) continue;

          const tgtData = newNodes[tgtIdx].data as ImageGenNodeData;
          const urls = [...(tgtData.inputImageUrls ?? [])];
          const refIdx = parseInt(edge.targetHandle.split('_')[1]);
          urls[refIdx] = imageUrl;
          const filled = urls.filter(Boolean).length;
          const maxRefs = MODELS[tgtData.model as keyof typeof MODELS]?.maxReferenceImages ?? 14;
          newNodes[tgtIdx] = {
            ...newNodes[tgtIdx],
            data: { ...newNodes[tgtIdx].data, inputImageUrls: urls, imagePortCount: Math.min(filled + 1, maxRefs) } as NodeData,
          };
        }

        setNodes([...nodesRef.current.map((n) => ({ ...n, selected: false })), ...newNodes]);
        setEdges([...edgesRef.current, ...internalEdges, ...externalEdges]);
        e.preventDefault();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setNodes, setEdges, groupSelectedNodes]);

  // Connection validation — only allow matching port types
  const isValidConnection = useCallback<IsValidConnection<Edge>>(
    (connectionOrEdge) => {
      const conn = connectionOrEdge as Connection;
      const sourceNode = nodes.find((n) => n.id === conn.source);
      const targetNode = nodes.find((n) => n.id === conn.target);
      if (!sourceNode || !targetNode) return false;

      // galleryOutputNode accepts any connection
      if (targetNode.type === 'galleryOutputNode') return true;

      const srcKey = `${sourceNode.type}:${conn.sourceHandle ?? ''}:source`;
      const tgtKey = `${targetNode.type}:${conn.targetHandle ?? ''}:target`;
      const srcType = PORT_TYPE_MAP[srcKey];
      const tgtType = PORT_TYPE_MAP[tgtKey];

      // upscaleMediaNode's single input accepts image or video
      if (targetNode.type === 'upscaleMediaNode' && conn.targetHandle === 'media') {
        if (srcType === 'image' || srcType === 'video') return true;
        if (invalidToastTimer.current) clearTimeout(invalidToastTimer.current);
        setInvalidToast(true);
        invalidToastTimer.current = setTimeout(() => setInvalidToast(false), 2500);
        return false;
      }

      if (!srcType || !tgtType) return true;

      if (srcType !== tgtType) {
        if (invalidToastTimer.current) clearTimeout(invalidToastTimer.current);
        setInvalidToast(true);
        invalidToastTimer.current = setTimeout(() => setInvalidToast(false), 2500);
        return false;
      }
      return true;
    },
    [nodes]
  );

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const canvasPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      setContextMenu({ x: e.clientX, y: e.clientY, canvasX: canvasPos.x, canvasY: canvasPos.y });
    },
    [screenToFlowPosition]
  );

  function getAutoConnectTargetHandle(sourceHandleId: string | null, targetNodeType: NodeType): string | null {
    if (sourceHandleId === 'prompt') {
      if (targetNodeType === 'imageGenNode' || targetNodeType === 'videoGenNode' || targetNodeType === 'modifyNode') return 'prompt';
    }
    if (sourceHandleId === 'image') {
      if (targetNodeType === 'videoGenNode')      return 'start_frame';
      if (targetNodeType === 'imageGenNode')      return 'ref_0';
      if (targetNodeType === 'upscaleNode')       return 'image';
      if (targetNodeType === 'upscaleMediaNode')  return 'media';
      if (targetNodeType === 'modifyNode')        return 'image';
      if (targetNodeType === 'removeBgNode')      return 'image';
      if (targetNodeType === 'outputNode')        return 'image';
      if (targetNodeType === 'imageToPromptNode') return 'image';
      if (targetNodeType === 'selectNode')        return 'input';
    }
    if (sourceHandleId === 'video') {
      if (targetNodeType === 'outputNode')        return 'video';
      if (targetNodeType === 'videoToGifNode')    return 'video';
      if (targetNodeType === 'videoUpscaleNode')  return 'video_in';
      if (targetNodeType === 'upscaleMediaNode')  return 'media';
    }
    return null;
  }

  function handleAddNode(type: NodeType, position?: { x: number; y: number }) {
    const pos = position ?? (contextMenu ? { x: contextMenu.canvasX, y: contextMenu.canvasY } : { x: 200, y: 200 });
    const nodeId = `${type}-${Date.now()}`;
    addNode({
      id: nodeId,
      type,
      position: pos,
      data: { ...DEFAULT_NODE_DATA[type] },
      ...(type === 'groupNode' ? { style: { width: 400, height: 300 } } : {}),
    } as Node<NodeData>);

    // Auto-connect if the menu was opened by dragging from a source handle
    const pending = pendingConnectionRef.current;
    if (pending?.nodeId && pending.handleType === 'source') {
      const targetHandle = getAutoConnectTargetHandle(pending.handleId, type);
      if (targetHandle) {
        const connection: Connection = {
          source:       pending.nodeId,
          sourceHandle: pending.handleId,
          target:       nodeId,
          targetHandle,
        };
        onConnectHandler(connection);
      }
    }
    pendingConnectionRef.current = null;
  }

  const propagateImageToTarget = useCallback(
    (sourceNodeId: string, targetEdge: Edge, imageUrl: string | null) => {
      // Always read fresh node data to avoid stale React closure issues
      const freshNodes = useFlowStore.getState().nodes;
      const targetNode = freshNodes.find((n) => n.id === targetEdge.target);
      if (!targetNode) return;
      const handle = targetEdge.targetHandle ?? '';

      if (targetNode.type === 'upscaleNode' || targetNode.type === 'modifyNode' || targetNode.type === 'removeBgNode') {
        updateNodeData(targetEdge.target, { inputImageUrl: imageUrl ?? undefined });
      } else if (targetNode.type === 'imageToPromptNode') {
        updateNodeData(targetEdge.target, { inputImageUrl: imageUrl ?? undefined });
      } else if (targetNode.type === 'videoGenNode') {
        if (handle === 'start_frame') updateNodeData(targetEdge.target, { startFrameUrl: imageUrl ?? undefined });
        else if (handle === 'end_frame') updateNodeData(targetEdge.target, { endFrameUrl: imageUrl ?? undefined });
      } else if (targetNode.type === 'imageGenNode') {
        const currentData = targetNode.data as ImageGenNodeData;
        const urls = [...(currentData.inputImageUrls ?? [])];
        if (handle.startsWith('ref_')) {
          const idx = parseInt(handle.split('_')[1]);
          urls[idx] = imageUrl ?? '';
        } else {
          urls[0] = imageUrl ?? '';
        }
        const filled = urls.filter(Boolean).length;
        const maxRefs = MODELS[currentData.model as keyof typeof MODELS]?.maxReferenceImages ?? 14;
        updateNodeData(targetEdge.target, { inputImageUrls: urls, imagePortCount: Math.min(filled + 1, maxRefs) });
      }
    },
    [updateNodeData]
  );

  useEffect(() => {
    function handleImagePropagate(e: Event) {
      const { sourceNodeId, imageUrl } = (e as CustomEvent).detail as { sourceNodeId: string; imageUrl: string | null };
      const connectedEdges = edges.filter((edge) => edge.source === sourceNodeId && edge.sourceHandle === 'image');
      for (const edge of connectedEdges) {
        propagateImageToTarget(sourceNodeId, edge, imageUrl);
      }
    }
    document.addEventListener('node:image-propagate', handleImagePropagate);
    return () => document.removeEventListener('node:image-propagate', handleImagePropagate);
  }, [edges, propagateImageToTarget]);

  useEffect(() => {
    function handleVideoPropagate(e: Event) {
      const { sourceNodeId, videoUrl } = (e as CustomEvent).detail as { sourceNodeId: string; videoUrl: string };
      const connectedEdges = edges.filter((edge) => edge.source === sourceNodeId && edge.sourceHandle === 'video');
      for (const edge of connectedEdges) {
        if (edge.targetHandle === 'video' || edge.targetHandle === 'video_in') {
          updateNodeData(edge.target, { videoUrl });
        }
      }
    }
    document.addEventListener('node:video-propagate', handleVideoPropagate);
    return () => document.removeEventListener('node:video-propagate', handleVideoPropagate);
  }, [edges, updateNodeData]);

  // Remove edges from a specific source handle (fired by MediaInputNode when switching media type).
  useEffect(() => {
    function handleRemoveSourceEdges(e: Event) {
      const { nodeId, handleId } = (e as CustomEvent).detail as { nodeId: string; handleId: string };
      const freshEdges = useFlowStore.getState().edges;
      const toRemove = freshEdges.filter((edge) => edge.source === nodeId && edge.sourceHandle === handleId);
      if (toRemove.length === 0) return;
      for (const edge of toRemove) {
        if (handleId === 'image') propagateImageToTarget(nodeId, edge, null);
        if (handleId === 'video' && (edge.targetHandle === 'video' || edge.targetHandle === 'video_in')) {
          updateNodeData(edge.target, { videoUrl: undefined });
        }
      }
      const removeIds = new Set(toRemove.map((edge) => edge.id));
      useFlowStore.getState().setEdges(freshEdges.filter((e) => !removeIds.has(e.id)));
    }
    document.addEventListener('node:remove-source-edges', handleRemoveSourceEdges);
    return () => document.removeEventListener('node:remove-source-edges', handleRemoveSourceEdges);
  }, [propagateImageToTarget, updateNodeData]);

  const onConnectHandler = useCallback(
    (connection: Connection) => {
      // ── Single-connection enforcement ────────────────────────────────
      // All target handles accept at most one incoming edge, except galleryOutputNode.
      const freshNodes = useFlowStore.getState().nodes;
      const freshEdges = useFlowStore.getState().edges;
      const targetNode = freshNodes.find((n) => n.id === connection.target);

      if (targetNode?.type !== 'galleryOutputNode') {
        const existing = freshEdges.filter(
          (e) => e.target === connection.target && e.targetHandle === connection.targetHandle
        );
        if (existing.length > 0) {
          for (const edge of existing) {
            if (edge.sourceHandle === 'image') propagateImageToTarget(edge.source, edge, null);
            if (edge.sourceHandle === 'prompt') updateNodeData(edge.target, { promptConnected: false });
          }
          const removedIds = new Set(existing.map((e) => e.id));
          useFlowStore.getState().setEdges(freshEdges.filter((e) => !removedIds.has(e.id)));
        }
      }

      // Add the new edge (reads fresh edges from store after the setEdges above)
      onConnect(connection);

      // ── Post-connect propagation ─────────────────────────────────────
      if (connection.sourceHandle === 'prompt') {
        const sourceNode = nodes.find((n) => n.id === connection.source);
        if (sourceNode?.type === 'promptNode') {
          const { prompt } = sourceNode.data as { prompt?: string };
          updateNodeData(connection.target, { prompt: prompt ?? '', promptConnected: true });
        } else if (sourceNode?.type === 'imageToPromptNode') {
          const { generatedPrompt } = sourceNode.data as ImageToPromptNodeData;
          updateNodeData(connection.target, { prompt: generatedPrompt ?? '', promptConnected: true });
        }
      }

      if (connection.sourceHandle === 'image') {
        // Use fresh store data — React closure may lag behind Zustand after a recent generation
        const latestNodes = useFlowStore.getState().nodes;
        const sourceNode = latestNodes.find((n) => n.id === connection.source);
        let imageUrl: string | undefined;
        if (sourceNode?.type === 'imageInputNode') imageUrl = (sourceNode.data as { imageUrl?: string }).imageUrl;
        else if (sourceNode?.type === 'mediaInputNode')   imageUrl = (sourceNode.data as MediaInputNodeData).imageUrl;
        else if (sourceNode?.type === 'upscaleMediaNode') imageUrl = (sourceNode.data as UpscaleMediaNodeData).outputImageUrl;
        else if (sourceNode?.type === 'imageGenNode') imageUrl = (sourceNode.data as ImageGenNodeData).generatedImages?.[0];
        else if (sourceNode?.type === 'upscaleNode')  imageUrl = (sourceNode.data as UpscaleNodeData).outputImageUrl;
        else if (sourceNode?.type === 'modifyNode')   imageUrl = (sourceNode.data as ModifyNodeData).outputImageUrl;
        else if (sourceNode?.type === 'selectNode')   imageUrl = (sourceNode.data as SelectNodeData).selectedImageUrl;
        else if (sourceNode?.type === 'removeBgNode') imageUrl = (sourceNode.data as RemoveBgNodeData).outputImageUrl;
        if (imageUrl) {
          propagateImageToTarget(connection.source, {
            id: '', source: connection.source, target: connection.target,
            sourceHandle: connection.sourceHandle, targetHandle: connection.targetHandle,
          }, imageUrl);
        }
      }

      if (connection.sourceHandle === 'video' && (connection.targetHandle === 'video' || connection.targetHandle === 'video_in')) {
        const latestNodes = useFlowStore.getState().nodes;
        const sourceNode = latestNodes.find((n) => n.id === connection.source);
        let videoUrl: string | undefined;
        if (sourceNode?.type === 'videoGenNode') videoUrl = (sourceNode.data as VideoGenNodeData).videoUrl;
        else if (sourceNode?.type === 'videoInputNode') videoUrl = (sourceNode.data as { videoUrl?: string }).videoUrl;
        else if (sourceNode?.type === 'mediaInputNode')   videoUrl = (sourceNode.data as MediaInputNodeData).videoUrl;
        else if (sourceNode?.type === 'upscaleMediaNode') videoUrl = (sourceNode.data as UpscaleMediaNodeData).outputVideoUrl;
        else if (sourceNode?.type === 'videoUpscaleNode') videoUrl = (sourceNode.data as { videoUrl?: string }).videoUrl;
        if (videoUrl) updateNodeData(connection.target, { videoUrl });
      }
    },
    [onConnect, nodes, updateNodeData, propagateImageToTarget]  // keep `nodes` for prompt propagation
  );

  const onEdgesChangeHandler = useCallback(
    (changes: EdgeChange[]) => {
      for (const change of changes) {
        if (change.type !== 'remove') continue;
        const edge = edges.find((e) => e.id === change.id);
        if (!edge) continue;
        if (edge.sourceHandle === 'image') {
          propagateImageToTarget(edge.source, edge, null);
        }
        if (edge.sourceHandle === 'video' && (edge.targetHandle === 'video' || edge.targetHandle === 'video_in')) {
          updateNodeData(edge.target, { videoUrl: undefined });
        }
        if (edge.sourceHandle === 'prompt') {
          // Check if the target still has another prompt edge after this removal
          const remaining = edges.filter((e) => e.id !== edge.id && e.target === edge.target && e.sourceHandle === 'prompt');
          if (remaining.length === 0) {
            updateNodeData(edge.target, { promptConnected: false });
          }
        }
      }
      onEdgesChange(changes);
    },
    [edges, onEdgesChange, propagateImageToTarget, updateNodeData]
  );

  const onConnectStart: OnConnectStart = useCallback((_, params) => {
    pendingConnectionRef.current = {
      nodeId:     params.nodeId     ?? '',
      handleId:   params.handleId   ?? null,
      handleType: params.handleType ?? null,
    };
  }, []);

  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
    // Only open menu when the drag ends without connecting to a valid target
    if (connectionState.isValid === true) {
      pendingConnectionRef.current = null;
      return;
    }
    const pending = pendingConnectionRef.current;
    if (!pending?.nodeId) return;

    const e = event as MouseEvent;
    const canvasPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setContextMenu({ x: e.clientX, y: e.clientY, canvasX: canvasPos.x, canvasY: canvasPos.y });
  }, [screenToFlowPosition]);

  function onDragOver(e: React.DragEvent) {
    const hasMediaFile = Array.from(e.dataTransfer.items).some(
      (item) => item.kind === 'file' && (item.type.startsWith('image/') || item.type.startsWith('video/'))
    );
    if (!hasMediaFile) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
  }

  function onDragLeave(e: React.DragEvent) {
    if (!reactFlowWrapper.current?.contains(e.relatedTarget as globalThis.Node | null)) {
      setIsDragOver(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files).filter(
      (f) => f.type.startsWith('image/') || f.type.startsWith('video/')
    );
    if (files.length === 0) return;

    const canvasPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });

    files.forEach((file, i) => {
      const position = { x: canvasPos.x + i * 280, y: canvasPos.y };
      const nodeId = `mediaInputNode-${Date.now()}-${i}`;

      // Create the node immediately so the user sees the processing state right away.
      addNode({
        id: nodeId,
        type: 'mediaInputNode',
        position,
        data: { uploadStatus: 'validating' } as MediaInputNodeData,
      } as Node<NodeData>);

      function setStatus(updates: Partial<MediaInputNodeData>) {
        document.dispatchEvent(new CustomEvent('node:update', { detail: { nodeId, data: updates } }));
      }

      if (file.type.startsWith('image/')) {
        (async () => {
          let processed: File;
          try {
            processed = await processImageFile(file, (stage, percent) => {
              if (stage === 'compressing') {
                setStatus({ uploadStatus: 'compressing', uploadProgress: percent ?? 0 });
              } else {
                setStatus({ uploadStatus: stage });
              }
            });
          } catch (err) {
            setStatus({
              uploadStatus: 'error',
              uploadError: err instanceof Error ? err.message : 'Failed to process image.',
              uploadProgress: undefined,
            });
            return;
          }
          setStatus({ uploadStatus: 'uploading', uploadProgress: undefined });
          try {
            const url = await uploadImageToStorage(processed);
            setStatus({ mediaType: 'image', imageUrl: url, uploadStatus: undefined, uploadProgress: undefined, uploadError: undefined });
            document.dispatchEvent(new CustomEvent('node:image-propagate', {
              detail: { sourceNodeId: nodeId, imageUrl: url },
            }));
          } catch (err) {
            setStatus({
              uploadStatus: 'error',
              uploadError: err instanceof Error ? err.message : 'Upload failed.',
              uploadProgress: undefined,
            });
          }
        })();
      } else {
        // Video — store in the module-level map so MediaInputNode can consume
        // it on mount (dispatching an event here would race against mount).
        setStatus({ uploadStatus: undefined });
        setPendingFile(nodeId, file);
      }
    });
  }

  const selectedCount = nodes.filter((n) => n.selected && n.type !== 'groupNode').length;

  return (
    <div
      ref={reactFlowWrapper}
      className="w-full h-full relative"
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {isDragOver && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none"
          style={{ background: 'rgba(59,158,255,0.08)', border: '2px dashed var(--color-accent)' }}
        >
          <p className="text-sm font-medium" style={{ color: 'var(--color-accent)' }}>
            Drop image to create an Image Input node
          </p>
        </div>
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChangeHandler}
        onConnect={onConnectHandler}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ animated: false, type: 'default' }}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        deleteKeyCode="Delete"
        multiSelectionKeyCode="Shift"
        selectionKeyCode="Shift"
        style={{ background: 'var(--color-bg-darkest)' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={28} size={1.5} color={theme === 'light' ? '#29292A' : 'rgba(255,255,255,0.18)'} />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor="var(--color-bg-surface)"
          maskColor="rgba(0,0,0,0.4)"
          style={{ background: 'var(--color-bg-elevated)', border: 'var(--border-default)' }}
        />
        <Panel position="bottom-center">
          <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>
            Right-click to add nodes · Shift+click or drag to multi-select · Ctrl+G to group · Delete removes selected
          </p>
        </Panel>
      </ReactFlow>

      <InvalidConnectionToast visible={invalidToast} />

      {contextMenu && (
        <NodeToolbar
          x={contextMenu.x}
          y={contextMenu.y}
          onAdd={(type) => handleAddNode(type)}
          onClose={() => setContextMenu(null)}
          selectedCount={selectedCount}
          onGroup={groupSelectedNodes}
          allowedTypes={allowedTypes}
        />
      )}
    </div>
  );
}
