import { getBezierPath, useReactFlow, type EdgeProps } from '@xyflow/react';
import { useRef, useState } from 'react';
import { PORT_TYPE_MAP, PORT_COLORS } from '../nodes/TypedHandle';

export function CustomEdge({
  id,
  source,
  sourceHandleId,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
}: EdgeProps) {
  const [hovered, setHovered] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { getNode, setEdges } = useReactFlow();

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const sourceNode = getNode(source);
  const srcKey = `${sourceNode?.type}:${sourceHandleId ?? ''}:source`;
  const portType = PORT_TYPE_MAP[srcKey] ?? 'text';
  const color = PORT_COLORS[portType];

  const isActive = hovered || selected;

  function onHoverStart() {
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
    setHovered(true);
  }

  function onHoverEnd() {
    leaveTimer.current = setTimeout(() => setHovered(false), 400);
  }

  function deleteEdge(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    setEdges((edges) => edges.filter((edge) => edge.id !== id));
  }

  return (
    <>
      <path
        d={edgePath}
        stroke={color}
        strokeWidth={isActive ? 2.5 : 2}
        fill="none"
        style={{
          filter: selected ? `drop-shadow(0 0 5px ${color}99)` : undefined,
          transition: 'stroke-width 0.1s',
          pointerEvents: 'none',
        }}
      />

      {/* Wide transparent hit path — 'stroke' overrides inherited visibleStroke so transparent stroke fires events */}
      <path
        d={edgePath}
        stroke="transparent"
        strokeWidth={28}
        fill="none"
        style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
        onMouseEnter={onHoverStart}
        onMouseLeave={onHoverEnd}
      />

      {/*
       * Always in DOM — opacity/pointerEvents toggled, not mount/unmount.
       * 'all' overrides .react-flow__edge { pointer-events: visibleStroke }
       * which would otherwise make the transparent fill circle unclickable.
       */}
      <g
        onClick={deleteEdge}
        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
        onMouseEnter={onHoverStart}
        onMouseLeave={onHoverEnd}
        style={{
          cursor: 'pointer',
          pointerEvents: isActive ? 'all' : 'none',
          opacity: isActive ? 1 : 0,
          transition: 'opacity 0.1s',
        }}
      >
        <circle cx={labelX} cy={labelY} r={28} fill="transparent" />
        <circle cx={labelX} cy={labelY} r={9} fill="var(--color-bg-elevated)" stroke={color} strokeWidth={1.5} />
        <line x1={labelX - 3.5} y1={labelY - 3.5} x2={labelX + 3.5} y2={labelY + 3.5} stroke={color} strokeWidth={1.5} strokeLinecap="round" />
        <line x1={labelX + 3.5} y1={labelY - 3.5} x2={labelX - 3.5} y2={labelY + 3.5} stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      </g>
    </>
  );
}
