'use client';

import type { ImageGenNodeData, VideoGenNodeData } from '@/types';
import { useFlowStore } from '@/lib/stores/flowStore';
import { createClient } from '@/lib/supabase/client';
import { findCanvasGeneration } from '@/lib/canvasGeneration';
import { savedGenerationPrompt, snapshotGenerationPrompt, withPromptHistoryEntry } from '@/lib/generationPromptHistory';

/** Select an asset and its own prompt without mutating any saved version. */
export async function selectGenerationVersion(
  nodeId: string, index: number, signal: AbortSignal,
  onPrompt: (prompt: string) => void,
): Promise<void> {
  const state = useFlowStore.getState();
  const flowId = state.currentFlow?.id;
  const node = state.nodes.find(node => node.id === nodeId);
  if (!node || signal.aborted) return;
  const data = node.data as ImageGenNodeData & VideoGenNodeData;
  const image = node.type === 'imageGenNode';
  const history = image ? data.generationHistory ?? [] : data.videoHistory ?? [];
  const media = history[index];
  if (media === undefined) return;
  const mediaUrl = Array.isArray(media) ? media[0] : media;
  const snapshot = data.generationPromptHistory?.[index];
  const restored = snapshotGenerationPrompt(snapshot ?? { prompt: '' });
  state.updateNodeData(nodeId, {
    ...(image ? { generatedImages: media as string[] } : { videoUrl: media as string }),
    ...restored,
    promptHistorySource: data.promptConnected ? data.promptHistorySource ?? snapshotGenerationPrompt(data) : undefined,
  });
  onPrompt(restored.prompt);
  if (mediaUrl) document.dispatchEvent(new CustomEvent(image ? 'node:image-propagate' : 'node:video-propagate', {
    detail: { sourceNodeId: nodeId, [image ? 'imageUrl' : 'videoUrl']: mediaUrl },
  }));
  if (snapshot || !mediaUrl) return;

  // Older flows only saved URLs. Look up that exact asset, never the latest generation.
  const generation = await findCanvasGeneration(createClient(), mediaUrl, signal);
  if (signal.aborted) return;
  const savedPrompt = generation && savedGenerationPrompt(generation);
  if (!savedPrompt) throw new Error('The saved prompt is unavailable for this version.');
  const latest = useFlowStore.getState();
  const current = latest.nodes.find(node => node.id === nodeId)?.data as typeof data | undefined;
  if (latest.currentFlow?.id !== flowId || !current) return;
  const currentHistory = image ? current.generationHistory ?? [] : current.videoHistory ?? [];
  if (JSON.stringify(currentHistory[index]) !== JSON.stringify(media)) return;
  const updates: Partial<ImageGenNodeData & VideoGenNodeData> = {
    generationPromptHistory: withPromptHistoryEntry(current.generationPromptHistory, currentHistory.length, index, savedPrompt),
  };
  // A slow lookup must not replace typing, a new generation, or another selected version.
  const selected = image ? current.generatedImages : current.videoUrl;
  if (JSON.stringify(selected) === JSON.stringify(media) && current.prompt === restored.prompt
    && current.generationRunId === data.generationRunId) {
    Object.assign(updates, snapshotGenerationPrompt(savedPrompt));
    onPrompt(savedPrompt.prompt);
  }
  latest.updateNodeData(nodeId, updates);
}
