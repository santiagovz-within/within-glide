import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';

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
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      style={{
        stroke: selected ? '#60c0ff' : 'var(--color-accent)',
        strokeWidth: 2,
        filter: selected ? 'drop-shadow(0 0 6px rgba(59,158,255,0.6))' : undefined,
      }}
    />
  );
}
