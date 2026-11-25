'use client';

import { useEffect, useState } from 'react';
import type { Generation } from '@/types';
import { canCompleteSeedanceDraft, SEEDANCE_DRAFT_COMPLETE_ENDPOINT, videoGenerationMetadata } from '@/lib/seedanceDraft';
import { useFalCostEstimateValue } from '@/lib/useFalCostEstimate';
import { formatFalCostEstimate } from '@/lib/falPricing';
import { useMediaMetadata } from '@/lib/useMediaMetadata';
import { ExpensiveGenerationDialog } from '@/components/canvas/nodes/ExpensiveGenerationDialog';

export function ChatDraftActions({ generation, generations, submitting, onComplete, onView }: {
  generation: Generation;
  generations: Record<string, Generation>;
  submitting: boolean;
  onComplete: (generation: Generation) => void;
  onView: (generation: Generation) => void;
}) {
  const metadata = videoGenerationMetadata(generation);
  const [now, setNow] = useState(() => Date.now());
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!metadata.isDraft) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [metadata.isDraft]);
  const references = metadata.isDraft ? metadata.referenceVideoUrls ?? [] : [];
  const referenceMetadata = useMediaMetadata(references, 'video');
  const estimate = useFalCostEstimateValue(metadata.isDraft ? {
    endpoint: SEEDANCE_DRAFT_COMPLETE_ENDPOINT, resolution: '1080p',
    aspectRatio: metadata.aspectRatio, duration: metadata.duration,
    referenceVideos: references.map(url => referenceMetadata.get(url) ?? null),
  } : null);
  if (!metadata.isDraft && !metadata.sourceDraftGenerationId) return null;
  if (!metadata.isDraft) return <p className="text-sm">1080p Final</p>;
  const completionId = generation.parameters?.draftCompletionGenerationId;
  const final = (typeof completionId === 'string' ? generations[completionId] : undefined)
    ?? Object.values(generations).find(item => item.parameters?.sourceDraftGenerationId === generation.id);
  const completed = final?.status === 'completed';
  const pending = final ? ['pending', 'processing'].includes(final.status) : typeof completionId === 'string';
  const canComplete = canCompleteSeedanceDraft(metadata, now) && generation.status === 'completed';
  function complete() {
    setConfirming(false);
    if (!submitting && !pending && canCompleteSeedanceDraft(metadata)) onComplete(generation);
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">480p Draft</p>
      <button type="button" disabled={!completed && (submitting || pending || !canComplete)}
        className="rounded-full px-4 py-2.5 text-sm font-semibold bg-white text-black disabled:opacity-40"
        onClick={() => {
          if (completed) onView(final!);
          else if (estimate !== null && estimate > 8) setConfirming(true);
          else complete();
        }}>
        {completed ? 'View 1080p version' : submitting || pending ? 'Rendering 1080p…' : 'Generate 1080p'}
        {!completed && !pending && estimate !== null && ` · ${formatFalCostEstimate(estimate)}`}
      </button>
      {!completed && !pending && <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>
        {canComplete ? 'Render this saved draft at 1080p within 7 days. This is an additional charge.'
          : 'This draft has expired or cannot be completed. Generate a new draft to render at 1080p.'}
      </p>}
      {confirming && estimate !== null && <ExpensiveGenerationDialog estimatedCostUsd={estimate}
        onConfirm={complete} onCancel={() => setConfirming(false)} />}
    </div>
  );
}
