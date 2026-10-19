'use client';

import { useEffect, useState } from 'react';
import { Film } from 'lucide-react';
import type { VideoGenNodeData } from '@/types';
import { useFlowStore } from '@/lib/stores/flowStore';
import { startTrackedVideoGeneration } from '@/lib/generationTracker';
import { canCompleteSeedanceDraft, SEEDANCE_DRAFT_COMPLETE_ENDPOINT } from '@/lib/seedanceDraft';
import { useMediaMetadata } from '@/lib/useMediaMetadata';
import { useFalCostEstimateValue } from '@/lib/useFalCostEstimate';
import { formatFalCostEstimate } from '@/lib/falPricing';
import { cn } from '@/lib/utils/cn';
import { ExpensiveGenerationDialog } from './ExpensiveGenerationDialog';
import glassStyles from './ImageGenerationGlass.module.css';

export function SeedanceDraftToggle({ enabled, disabled, onChange }: {
  enabled: boolean; disabled: boolean; onChange: (enabled: boolean) => void;
}) {
  return (
    <div className={glassStyles.footerStack}>
      <div className={glassStyles.rowBetween}>
        <span className={glassStyles.microLabel}>Draft mode</span>
        <button type="button" aria-label="Draft mode" aria-pressed={enabled} disabled={disabled}
          onClick={() => onChange(!enabled)}
          className={cn(glassStyles.glassSurface, glassStyles.switch, enabled && glassStyles.switchOn, 'nodrag disabled:opacity-40')}>
          <span className={cn(glassStyles.glassContent, glassStyles.switchKnob)} />
        </button>
      </div>
      {enabled && <p className={glassStyles.microLabel}>Preview at 480p. Finish your favorite at 1080p within 7 days.</p>}
    </div>
  );
}

/** Actions follow the selected history entry, never the current prompt or references. */
export function SeedanceDraftActions({ data, nodeId, nodeType, historyIndex, isGenerating, onSelectVersion }: {
  data: VideoGenNodeData;
  nodeId: string;
  nodeType: 'videoGenNode' | 'referenceVideoNode';
  historyIndex: number;
  isGenerating: boolean;
  onSelectVersion: (index: number) => void;
}) {
  const currentFlow = useFlowStore(state => state.currentFlow);
  const result = data.videoHistoryMetadata?.[historyIndex];
  const [now, setNow] = useState(() => Date.now());
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!result?.isDraft) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [result?.isDraft]);
  const referenceUrls = result?.isDraft ? result.referenceVideoUrls ?? [] : [];
  const referenceMetadata = useMediaMetadata(referenceUrls, 'video');
  const estimate = useFalCostEstimateValue(result?.isDraft ? {
    endpoint: SEEDANCE_DRAFT_COMPLETE_ENDPOINT, resolution: '1080p',
    aspectRatio: result.aspectRatio, duration: result.duration,
    referenceVideos: referenceUrls.map(url => referenceMetadata.get(url) ?? null),
  } : null);
  if (!result?.isDraft && !result?.sourceDraftGenerationId) return null;
  const finalIndex = data.videoHistoryMetadata?.findIndex(entry => entry?.sourceDraftGenerationId === result.generationId) ?? -1;
  const canComplete = canCompleteSeedanceDraft(result, now);
  const expiresAt = result.draftExpiresAt ? new Date(result.draftExpiresAt) : undefined;
  const expirationKnown = expiresAt && Number.isFinite(expiresAt.getTime());

  function complete() {
    setConfirming(false);
    if (!currentFlow || isGenerating || !result || !canCompleteSeedanceDraft(result)) return;
    useFlowStore.getState().consumeGcsOnlyEligibility();
    void startTrackedVideoGeneration({
      flowId: currentFlow.id, flowTitle: currentFlow.title, nodeId, nodeType, data,
      endpoint: SEEDANCE_DRAFT_COMPLETE_ENDPOINT, submissionUrl: '/api/fal/draft/complete',
      payload: { draftGenerationId: result.generationId, sourceType: 'canvas', sourceId: currentFlow.id, nodeId },
    });
  }

  return (
    <div className={cn(glassStyles.footerStack, 'nodrag')}>
      <div className={glassStyles.rowBetween}>
        <span className={glassStyles.microLabel}>{result.isDraft ? '480p Draft' : '1080p Final'}</span>
        {result.isDraft && expirationKnown && <span className={glassStyles.microLabel} title={expiresAt.toLocaleString()}>
          {canComplete ? `Expires ${expiresAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : 'Draft expired'}
        </span>}
      </div>
      {result.isDraft && (finalIndex >= 0 ? (
        <button type="button" onClick={() => onSelectVersion(finalIndex)}
          className={cn(glassStyles.glassSurface, glassStyles.button, glassStyles.generateButton)}>
          <span className={cn(glassStyles.glassContent, glassStyles.buttonContent)}>View 1080p version</span>
        </button>
      ) : (
        <>
          <button type="button" disabled={!canComplete || isGenerating || !currentFlow}
            onClick={() => estimate !== null && estimate > 8 ? setConfirming(true) : complete()}
            title="Render this saved draft at 1080p. The estimate is an additional charge and includes the original video references."
            className={cn(glassStyles.glassSurface, glassStyles.button, glassStyles.generateButton, 'disabled:opacity-40')}>
            <span className={cn(glassStyles.glassContent, glassStyles.buttonContent)}>
              <Film size={12} />
              {isGenerating && data.pendingEndpoint === SEEDANCE_DRAFT_COMPLETE_ENDPOINT ? 'Rendering 1080p…' : 'Generate 1080p'}
              <span className={glassStyles.costEstimate}>{formatFalCostEstimate(estimate) ?? 'Estimate unavailable'}</span>
            </span>
          </button>
          {!canComplete && <p className={glassStyles.microLabel}>
            {expirationKnown ? 'Generate a new draft to finish at 1080p.' : 'Completion is unavailable for this preview. Generate a new draft.'}
          </p>}
        </>
      ))}
      {confirming && estimate !== null && <ExpensiveGenerationDialog estimatedCostUsd={estimate}
        onConfirm={complete} onCancel={() => setConfirming(false)} />}
    </div>
  );
}
