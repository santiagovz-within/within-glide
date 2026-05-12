import { BaseEdge, getBezierPath, useReactFlow, type EdgeProps } from '@xyflow/react';
import { X } from 'lucide-react';
import { useState } from 'react';

export function CustomEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
}: EdgeProps) {
  const [hovered, setHovered] = useState(false);
  const { setEdges } = useReactFlow();

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const isActive = hovered || selected;

  function deleteEdge(e: React.MouseEvent) {
    e.stopPropagation();
    setEdges((edges) => edges.filter((edge) => edge.id !== id));
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? '#60c0ff' : 'var(--color-accent)',
          strokeWidth: 2,
          filter: selected ? 'drop-shadow(0 0 6px rgba(59,158,255,0.6))' : undefined,
          strokeDasharray: 'none',
        }}
      />

      {/* Wide invisible path for easier hover targeting */}
      <path
        d={edgePath}
        stroke="transparent"
        strokeWidth={20}
        fill="none"
        style={{ cursor: 'pointer' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />

      {/* Delete button shown on hover or selection */}
      {isActive && (
        <foreignObject
          x={labelX - 10}
          y={labelY - 10}
          width={20}
          height={20}
          style={{ overflow: 'visible' }}
        >
          <button
            onClick={deleteEdge}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: 'var(--color-bg-elevated)',
              border: '1px solid var(--color-accent)',
              color: 'var(--color-accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              padding: 0,
              lineHeight: 1,
            }}
          >
            <X size={10} />
          </button>
        </foreignObject>
      )}
    </>
  );
}
