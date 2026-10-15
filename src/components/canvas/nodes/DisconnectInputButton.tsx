'use client';

import { useReactFlow, useStore } from '@xyflow/react';
import { X } from 'lucide-react';
import type { CSSProperties } from 'react';

export function DisconnectInputButton({ edgeId, label = 'input', style }: { edgeId: string; label?: string; style?: CSSProperties }) {
  const { deleteElements } = useReactFlow();
  const editable = useStore(state => state.nodesConnectable);
  if (!editable) return null;
  return (
    <button type="button" aria-label={`Disconnect ${label}`} title={`Disconnect ${label}`}
      className="nodrag nopan relative z-10 flex shrink-0 items-center justify-center rounded hover:bg-white/20 focus-visible:outline-2"
      style={{ width: 22, height: 22, marginLeft: 'auto', ...style }}
      onPointerDown={event => event.stopPropagation()}
      onMouseDown={event => event.stopPropagation()}
      onClick={event => {
        event.stopPropagation();
        // Use React Flow's removal pipeline so cached inputs and prompt state
        // are cleared just as they are when disconnecting on the edge.
        void deleteElements({ edges: [{ id: edgeId }] });
      }}>
      <X size={12} aria-hidden />
    </button>
  );
}
