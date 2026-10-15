'use client';

import { useState, type ReactNode, type Ref } from 'react';
import { useStore } from '@xyflow/react';
import { GripVertical } from 'lucide-react';
import { useFlowStore } from '@/lib/stores/flowStore';
import { cn } from '@/lib/utils/cn';
import { orderedInputEdges, reorderInputConnections } from '../reorderInputConnections';
import { DisconnectInputButton } from './DisconnectInputButton';
import glassStyles from './ImageGenerationGlass.module.css';

const REFERENCE_DRAG_TYPE = 'application/x-canvas-reference';

export function ReferenceInputRow({ nodeId, edgeId, label, connected = !!edgeId, canReorder, kind = 'image', compact, children, ref }: {
  nodeId: string;
  edgeId?: string;
  label: string;
  connected?: boolean;
  canReorder: boolean;
  kind?: 'image' | 'video';
  compact?: boolean;
  children?: ReactNode;
  ref?: Ref<HTMLDivElement>;
}) {
  const editable = useStore(state => state.nodesConnectable);
  const [dropTarget, setDropTarget] = useState(false);
  const [dragging, setDragging] = useState(false);
  const reorderable = editable && canReorder && !!edgeId;

  function move(fromId: string, toId: string) {
    const { nodes, edges } = useFlowStore.getState();
    const next = reorderInputConnections(nodes, edges, nodeId, fromId, toId);
    if (next) useFlowStore.setState({ ...next, isDirty: true });
  }

  return (
    <div ref={ref} className={cn(glassStyles.glassSurface, glassStyles.connector, 'nodrag nopan',
      connected ? kind === 'video' ? glassStyles.connectorActiveVideo : glassStyles.connectorActive : glassStyles.connectorInactive)}
      style={{ height: children && !compact ? 48 : undefined, outline: dropTarget ? '2px solid currentColor' : undefined, opacity: dragging ? 0.5 : undefined }}
      onDragOver={event => {
        if (!reorderable || !event.dataTransfer.types.includes(REFERENCE_DRAG_TYPE)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        setDropTarget(true);
      }}
      onDragLeave={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(false);
      }}
      onDrop={event => {
        if (!reorderable || !event.dataTransfer.types.includes(REFERENCE_DRAG_TYPE)) return;
        event.preventDefault();
        event.stopPropagation();
        setDropTarget(false);
        try {
          const source = JSON.parse(event.dataTransfer.getData(REFERENCE_DRAG_TYPE));
          if (source.nodeId === nodeId && typeof source.edgeId === 'string') move(source.edgeId, edgeId);
        } catch { /* Ignore unrelated/malformed drops. */ }
      }}>
      {reorderable && <button type="button" draggable aria-label={`Reorder ${label}`} title="Drag to reorder, or use ↑ / ↓"
        className={cn(glassStyles.glassContent, 'nodrag nopan flex shrink-0 cursor-grab items-center justify-center active:cursor-grabbing')}
        style={{ width: 18, height: 22 }}
        onPointerDown={event => event.stopPropagation()}
        onMouseDown={event => event.stopPropagation()}
        onDragStart={event => {
          event.stopPropagation();
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData(REFERENCE_DRAG_TYPE, JSON.stringify({ nodeId, edgeId }));
          event.dataTransfer.setDragImage(event.currentTarget.parentElement!, 20, 14);
          setDragging(true);
        }}
        onDragEnd={() => { setDragging(false); setDropTarget(false); }}
        onKeyDown={event => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          event.stopPropagation();
          const { nodes, edges } = useFlowStore.getState();
          const node = nodes.find(node => node.id === nodeId);
          if (!node) return;
          const group = orderedInputEdges(node, edges, edgeId);
          const index = group.findIndex(edge => edge.id === edgeId);
          const target = group[index + (event.key === 'ArrowUp' ? -1 : 1)];
          if (target) move(edgeId, target.id);
        }}><GripVertical size={13} aria-hidden /></button>}
      {children && <div className={cn(glassStyles.glassContent, 'shrink-0')} style={{ width: compact ? 26 : 40, height: compact ? 22 : 32, overflow: 'hidden', borderRadius: 4 }}>{children}</div>}
      <span className={glassStyles.glassContent} style={{ flex: 1 }}>{label}</span>
      {edgeId && <DisconnectInputButton edgeId={edgeId} label={label} />}
    </div>
  );
}
