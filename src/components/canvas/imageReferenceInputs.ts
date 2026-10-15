import type { Edge } from '@xyflow/react';

/** Occupied connections reserve slots even while their sources have no media URL. */
export function imageReferencePortCount(nodeId: string, edges: Edge[], limit: number): number {
  const indexes = edges.filter(edge => edge.target === nodeId && edge.targetHandle?.startsWith('ref_'))
    .map(edge => Number(edge.targetHandle?.slice(4))).filter(Number.isInteger);
  return Math.min(Math.max(-1, ...indexes) + 2, limit);
}
