/** Generation fields are reconciled separately from editable canvas content. */
const GENERATION_KEYS = [
  'status', 'generationRunId', 'resolvedRequestIds', 'pendingRequests', 'pendingRequestId',
  'pendingEndpoint', 'generationSlots', 'generationErrors', 'generatedImages',
  'generationHistory', 'videoUrl', 'videoHistory', 'errorMessage', 'errorRequestId',
] as const;

type Data = Record<string, unknown>;
export function generationRequestIds(data: Data): string[] {
  const requests = Array.isArray(data.pendingRequests) ? data.pendingRequests : [];
  return [...new Set([
    ...requests.flatMap((r) => typeof r?.requestId === 'string' ? [r.requestId] : []),
    ...(typeof data.pendingRequestId === 'string' ? [data.pendingRequestId] : []),
  ])].sort();
}

export function generationIdentity(data: Data): string {
  if (typeof data.generationRunId === 'string') return data.generationRunId;
  const ids = generationRequestIds(data);
  const resolved = Array.isArray(data.resolvedRequestIds) ? data.resolvedRequestIds : [];
  return (ids.length ? ids : resolved).filter((id): id is string => typeof id === 'string').sort().join(',');
}

export function isTerminalNode(data: Data): boolean {
  return data.status === 'completed' || data.status === 'error';
}

export function mergeGenerationData(incoming: Data, stored: Data, base: Data): Data {
  const currentId = generationIdentity(stored);
  const incomingId = generationIdentity(incoming);
  const baseId = generationIdentity(base);
  // Preserve a newer attempt from another tab, or a terminal result for the
  // same attempt. A deliberate new attempt is allowed when its base still matches.
  const preserve = (currentId !== baseId && currentId !== incomingId)
    || (currentId === incomingId && isTerminalNode(stored)
      && (!isTerminalNode(incoming) || generationRequestIds(incoming).length > 0
        || (stored.status === 'completed' && incoming.status === 'error')))
    || (!incomingId && !!currentId && currentId !== baseId);
  if (!preserve) return incoming;
  const merged = { ...incoming };
  for (const key of GENERATION_KEYS) {
    delete merged[key];
    if (stored[key] !== undefined) merged[key] = stored[key];
  }
  return merged;
}

export function mergeGenerationNodes<T extends { id: string; type?: string; data: Data }>(
  incoming: T[], stored: T[], base: Array<{ id: string; data: Data }>,
): T[] {
  const current = new Map(stored.map((node) => [node.id, node]));
  const previous = new Map(base.map((node) => [node.id, node]));
  const incomingIds = new Set(incoming.map((node) => node.id));
  return [
    ...incoming.flatMap((node) => {
      const saved = current.get(node.id);
      if (!saved && previous.has(node.id)) return []; // Deleted in another tab.
      if (!saved || !['imageGenNode', 'videoGenNode', 'referenceVideoNode'].includes(node.type ?? '')) return [node];
      return [{ ...node, data: mergeGenerationData(node.data, saved.data, previous.get(node.id)?.data ?? {}) }];
    }),
    ...stored.filter((node) => !previous.has(node.id) && !incomingIds.has(node.id)),
  ];
}
