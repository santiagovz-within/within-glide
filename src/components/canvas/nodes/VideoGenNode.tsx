'use client';

import { GenerationPreview } from './GenerationPreview';
import { useGenerationHistoryPrompt } from '@/lib/useGenerationHistoryPrompt';

import { Position, type NodeProps } from '@xyflow/react';
import { Film, AlertTriangle, Download, ChevronLeft, ChevronRight, Clock3 } from 'lucide-react';
import Image from 'next/image';
import { downloadFromUrl } from '@/lib/utils/download';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NodeWrapper } from './NodeWrapper';
import { GenerationFailureOverlay, RegenerateGate } from './GenerationFailure';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import { PromptEditor } from './PromptEditor';
import { getVideoFrameTaggableInputs, syncTagsWithText, missingPromptTags, compileMediaPromptTags } from '@/lib/promptTags';
import { ReferenceInputRow } from './ReferenceInputRow';
import { DisconnectInputButton } from './DisconnectInputButton';
import type { VideoGenNodeData, ImageInputNodeData, ImageGenNodeData, MediaInputNodeData } from '@/types';
import { VIDEO_MODELS } from '@/lib/api/models';
import { getVideoGenerationSettings } from '@/lib/videoGenerationSettings';
import { ModelSelect } from './ModelSelect';
import { NodeSelect } from './NodeSelect';
import { useFlowStore } from '@/lib/stores/flowStore';
import { CanvasImage, CanvasVideo } from '@/components/canvas/CanvasMedia';
import { generationJobId, useGenerationStore } from '@/lib/stores/generationStore';
import { startTrackedVideoGeneration } from '@/lib/generationTracker';
import { cn } from '@/lib/utils/cn';
import glassStyles from './ImageGenerationGlass.module.css';
import { AspectRatioGlyph } from './AspectRatioGlyph';
import FalCostEstimate from './FalCostEstimate';
import { ExpensiveGenerationDialog } from './ExpensiveGenerationDialog';
import { useFalCostEstimateValue } from '@/lib/useFalCostEstimate';
import { SeedanceDraftActions, SeedanceDraftToggle } from './SeedanceDraftControls';

type VideoResolution = NonNullable<VideoGenNodeData['videoResolution']>;

/** Seedance 2.0 / 2.5 runs estimated above this get a warning and a confirm step. */
const EXPENSIVE_VIDEO_COST_USD = 8;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function VideoGenNode({ data, selected, id }: NodeProps & { data: VideoGenNodeData }) {
  const currentFlow = useFlowStore((state) => state.currentFlow);
  const activeJobId = currentFlow ? generationJobId(currentFlow.id, id) : '';
  const isGenerating = useGenerationStore((state) => !!state.jobs[activeJobId]);
  const videoHistory = data.videoHistory ?? [];
  const [histIdx, setHistIdx] = useState(() => {
    const savedIndex = data.videoUrl ? videoHistory.lastIndexOf(data.videoUrl) : -1;
    return savedIndex >= 0 ? savedIndex : Math.max(0, videoHistory.length - 1);
  });
  const [historyLength, setHistoryLength] = useState(videoHistory.length);
  if (historyLength !== videoHistory.length) {
    setHistoryLength(videoHistory.length);
    if (videoHistory.length > historyLength) setHistIdx(videoHistory.length - 1);
  }
  const promptSectionRef = useRef<HTMLDivElement>(null);
  const startFrameRowRef = useRef<HTMLDivElement>(null);
  const endFrameRowRef = useRef<HTMLDivElement>(null);
  const [promptHandleTop, setPromptHandleTop] = useState(50);
  const [startFrameHandleTop, setStartFrameHandleTop] = useState(200);
  const [endFrameHandleTop, setEndFrameHandleTop] = useState(261);

  const [localPrompt, setLocalPrompt] = useState(() => data.prompt ?? '');
  const { restoreVersion, restoringPrompt, promptHistoryError } = useGenerationHistoryPrompt(id, setLocalPrompt);
  const isFocused = useRef(false);
  useEffect(() => {
    if (!isFocused.current) setLocalPrompt(data.prompt ?? '');
  }, [data.prompt]);


  const isSeedanceFull = data.model === 'seedance-2';
  const isSeedance25 = data.model === 'seedance-2-5';
  const videoSettings = getVideoGenerationSettings(data);
  const { draftMode, lockedResolution, followsInputAspect, supportsEndFrame, supportsAudio } = videoSettings;
  const aspectRatios = videoSettings.model.supportedAspectRatios;
  const resolutionOptions = videoSettings.resolutions;
  const durationOptions = videoSettings.durations.map(duration => `${duration}s`);
  const selectedDuration = videoSettings.duration;
  const selectedResolution = videoSettings.resolution;

  const costEstimateInput = {
    endpoint: videoSettings.endpoint,
    aspectRatio: data.aspectRatio,
    resolution: selectedResolution,
    duration: selectedDuration,
    generateAudio: data.generateAudio ?? true,
  };
  const estimatedCostUsd = useFalCostEstimateValue(costEstimateInput);
  const needsCostConfirmation = (isSeedanceFull || isSeedance25)
    && estimatedCostUsd !== null
    && estimatedCostUsd > EXPENSIVE_VIDEO_COST_USD;
  const [confirmingCost, setConfirmingCost] = useState(false);

  // Read start-frame source node directly from store (reactive, zero-latency)
  const storeEdges = useFlowStore(state => state.edges);
  const promptEdge = storeEdges.find(edge => edge.target === id && edge.targetHandle === 'prompt');
  const storeNodes = useFlowStore(state => state.nodes);
  const startFrameEdge = storeEdges.find(e => e.target === id && e.targetHandle === 'start_frame');
  const endFrameEdge = storeEdges.find(e => e.target === id && e.targetHandle === 'end_frame');
  const startFrameSource = startFrameEdge ? storeNodes.find(n => n.id === startFrameEdge.source) : undefined;
  const taggableInputs = getVideoFrameTaggableInputs(id, storeEdges, data);
  const promptTags = syncTagsWithText(data.prompt ?? '', data.promptTags ?? [], taggableInputs);
  const missingTags = missingPromptTags(promptTags, taggableInputs);
  const hasPendingInputs = taggableInputs.some(input => !input.url);
  const inputWarning = missingTags.length
    ? `Missing reference: ${missingTags.map(tag => `@${tag.label}`).join(', ')}. Reconnect it, wait for its upload, or edit the tag.`
    : hasPendingInputs ? 'Waiting for connected image uploads' : undefined;


  // Derive aspect ratio from source node data synchronously
  const derivedAspect = (() => {
    if (!followsInputAspect || !startFrameSource) return undefined;
    if (startFrameSource.type === 'imageInputNode' || startFrameSource.type === 'mediaInputNode') {
      const { naturalWidth, naturalHeight } = startFrameSource.data as ImageInputNodeData | MediaInputNodeData;
      if (naturalWidth && naturalHeight) {
        const g = gcd(naturalWidth, naturalHeight);
        return `${naturalWidth / g}:${naturalHeight / g}`;
      }
    }
    if (startFrameSource.type === 'imageGenNode') {
      return (startFrameSource.data as ImageGenNodeData).aspectRatio;
    }
    return undefined;
  })();

  // Persist derived ratio to node data whenever it changes
  useEffect(() => {
    if (derivedAspect && derivedAspect !== data.imageAspectRatio) {
      updateData({ imageAspectRatio: derivedAspect, aspectRatio: derivedAspect });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivedAspect]);

  // Clear an input-derived ratio when the image is disconnected or the model no longer follows it.
  useEffect(() => {
    if (!followsInputAspect && data.imageAspectRatio) {
      updateData({
        imageAspectRatio: undefined,
        ...(!aspectRatios.includes(data.aspectRatio) ? { aspectRatio: aspectRatios[0] } : {}),
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followsInputAspect]);

  useLayoutEffect(() => {
    if (!promptSectionRef.current) return;
    const el = promptSectionRef.current;
    setPromptHandleTop(el.offsetTop + el.offsetHeight / 2);
  }, [data.promptConnected, localPrompt]);

  useLayoutEffect(() => {
    const start = startFrameRowRef.current;
    const end = endFrameRowRef.current;
    if (start) setStartFrameHandleTop(start.offsetTop + start.offsetHeight / 2);
    if (end) setEndFrameHandleTop(end.offsetTop + end.offsetHeight / 2);
  }, [supportsEndFrame, data.startFrameUrl, data.endFrameUrl, supportsAudio, isSeedanceFull, localPrompt, data.promptConnected]);

  function updateData(updates: Partial<VideoGenNodeData>) {
    document.dispatchEvent(new CustomEvent('node:update', {
      detail: { nodeId: id, data: updates },
    }));
  }

  function handleModelChange(model: string) {
    const next = getVideoGenerationSettings({ ...data, model, draftMode: false });
    updateData({ model, aspectRatio: next.aspectRatio, videoResolution: next.resolution, duration: next.duration });
  }

  function navigateHistory(idx: number) {
    setHistIdx(idx);
    restoreVersion(idx);
  }

  function handleGenerate() {
    if (isGenerating || restoringPrompt || !currentFlow || inputWarning) return;
    if (needsCostConfirmation) {
      setConfirmingCost(true);
      return;
    }
    startGeneration();
  }

  function confirmExpensiveGeneration() {
    setConfirmingCost(false);
    startGeneration();
  }

  function startGeneration() {
    if (isGenerating || restoringPrompt || !currentFlow || inputWarning) return;

    const endpoint = videoSettings.endpoint;
    useFlowStore.getState().consumeGcsOnlyEligibility();
    void startTrackedVideoGeneration({
      flowId: currentFlow.id,
      flowTitle: currentFlow.title,
      nodeId: id,
      data: { ...data, promptTags },
      endpoint,
      payload: {
        model: data.model,
        prompt: compileMediaPromptTags(data.prompt ?? '', promptTags, taggableInputs, true),
        aspectRatio: data.aspectRatio,
        duration: selectedDuration,
        startFrameUrl: data.startFrameUrl,
        endFrameUrl: data.endFrameUrl,
        generateAudio: data.generateAudio ?? true,
        videoResolution: selectedResolution,
        draft: draftMode,
        sourceType: 'canvas',
        sourceId: currentFlow.id,
        nodeId: id,
      },
    });
  }

  /** Clears the failure so the Generate button unlocks for the edited inputs. */
  function acknowledgeFailure() {
    updateData({ status: 'idle', errorMessage: undefined, errorRequestId: undefined });
  }

  const displayVideoUrl = videoHistory.length > 0 ? (videoHistory[histIdx] ?? data.videoUrl) : data.videoUrl;
  const hasFailure = data.status === 'error';

  const videoAspect = (() => {
    const parts = data.aspectRatio.split(':');
    if (parts.length === 2 && !isNaN(Number(parts[0])) && !isNaN(Number(parts[1]))) {
      return `${parts[0]}/${parts[1]}`;
    }
    return '16/9';
  })();

  const currentAspectOptions = [
    ...(followsInputAspect && data.imageAspectRatio && !aspectRatios.includes(data.imageAspectRatio)
      ? [data.imageAspectRatio]
      : []),
    ...aspectRatios,
  ];

  const footer = (
    <div className={glassStyles.footerStack}>
      {(restoringPrompt || promptHistoryError) && <p className={glassStyles.microLabel} role="status">{restoringPrompt ? 'Restoring prompt…' : promptHistoryError}</p>}
      {inputWarning && <p className={glassStyles.microLabel} role="status">{inputWarning}</p>}
      <button
        onClick={handleGenerate}
        disabled={isGenerating || restoringPrompt || hasFailure || !!inputWarning}
        title={
          hasFailure
            ? 'Change the prompt or inputs, then confirm below to regenerate'
            : undefined
        }
        className={cn(
          glassStyles.glassSurface,
          glassStyles.button,
          glassStyles.generateButton,
          'transition-opacity disabled:opacity-40 nodrag',
        )}
      >
        <span className={cn(glassStyles.glassContent, glassStyles.buttonContent)}>
          <Image src="/node-icons/icon-generate.svg" alt="" width={11} height={11} aria-hidden />
          {isGenerating ? 'Generating…' : draftMode ? 'Generate draft' : 'Generate'}
          <FalCostEstimate input={costEstimateInput} />
        </span>
      </button>

      {confirmingCost && estimatedCostUsd !== null && (
        <ExpensiveGenerationDialog
          estimatedCostUsd={estimatedCostUsd}
          onConfirm={confirmExpensiveGeneration}
          onCancel={() => setConfirmingCost(false)}
        />
      )}

      {hasFailure && <RegenerateGate onChangesApplied={acknowledgeFailure} />}
      <SeedanceDraftActions key={data.videoHistoryMetadata?.[histIdx]?.generationId ?? 'legacy'}
        data={data} nodeId={id} nodeType="videoGenNode" historyIndex={histIdx}
        isGenerating={isGenerating} onSelectVersion={navigateHistory} />

      {displayVideoUrl && (
        <button
          onClick={() => downloadFromUrl(displayVideoUrl)}
          className={cn(
            glassStyles.glassSurface,
            glassStyles.button,
            glassStyles.downloadButton,
            'nodrag transition-opacity hover:opacity-80 active:opacity-60',
          )}
        >
          <span className={cn(glassStyles.glassContent, glassStyles.buttonContent)}>
            <Download size={12} />
            Download
          </span>
        </button>
      )}
    </div>
  );

  return (
    <NodeWrapper
      title="Video Generation"
      icon={<Film size={14} />}
      status={data.status}
      errorMessage={data.errorMessage}
      selected={selected}
      minWidth={300}
      accentColor={PORT_COLORS.video}
      titlePosition="outside"
      appearance="imageGenerationGlass"
      footer={footer}
    >
      <TypedHandle
        type="target"
        position={Position.Left}
        id="prompt"
        portType="text"
        offset={`${promptHandleTop}px`}
        connected={!!data.promptConnected}
      />
      <TypedHandle
        type="target"
        position={Position.Left}
        id="start_frame"
        portType="image"
        offset={`${startFrameHandleTop}px`}
        connected={!!startFrameEdge}
      />
      {supportsEndFrame && (
        <TypedHandle
          type="target"
          position={Position.Left}
          id="end_frame"
          portType="image"
          offset={`${endFrameHandleTop}px`}
          connected={!!endFrameEdge}
          disabled={!startFrameEdge}
          disabledReason="Connect a Start Frame first — End Frame requires a Start Frame"
        />
      )}

      {/* Prompt */}
      {data.promptConnected && !data.promptHistorySource ? (
        <div ref={promptSectionRef} className={cn(glassStyles.glassSurface, glassStyles.promptSection,
          glassStyles.promptSurface, glassStyles.connectedTextPrompt)}>
          <div className={cn(glassStyles.glassContent, glassStyles.connectedPrompt)}>
            Prompt connected
            {promptEdge && <DisconnectInputButton edgeId={promptEdge.id} label="prompt" style={{ height: 20 }} />}
          </div>
        </div>
      ) : (
        <PromptEditor containerRef={promptSectionRef} value={localPrompt} tags={promptTags} taggable={taggableInputs}
          placeholder="Describe the video. Type @ to reference a frame…"
          onFocusChange={focused => { isFocused.current = focused; }}
          onChange={({ prompt, tags }) => { setLocalPrompt(prompt); updateData({ prompt, promptTags: tags }); }} />
      )}

      {/* Model selector */}
      <ModelSelect options={VIDEO_MODELS} value={data.model} onChange={handleModelChange} />
      {isSeedance25 && <SeedanceDraftToggle enabled={draftMode} disabled={isGenerating}
        onChange={draftMode => updateData({ draftMode })} />}

      {needsCostConfirmation && (
        <div className={cn(glassStyles.notice, glassStyles.noticeExpensive, 'nodrag')}>
          <AlertTriangle size={11} className="shrink-0 mt-0.5" />
          You&apos;re about to spend ${estimatedCostUsd.toFixed(2)} on this generation, please
          review it and make sure your prompt and configuration is correct
        </div>
      )}

      {supportsAudio && (
        <div className={glassStyles.rowBetween}>
          <span className={glassStyles.microLabel}>Generate Audio</span>
          <button
            className={cn(
              glassStyles.glassSurface,
              glassStyles.switch,
              (data.generateAudio ?? true) && glassStyles.switchOn,
              'nodrag',
            )}
            aria-pressed={data.generateAudio ?? true}
            onClick={() => updateData({ generateAudio: !(data.generateAudio ?? true) })}
          >
            <span className={cn(glassStyles.glassContent, glassStyles.switchKnob)} />
          </button>
        </div>
      )}

      <div className={glassStyles.grid3}>
        <div className={glassStyles.field}>
          <NodeSelect
            options={currentAspectOptions}
            value={data.aspectRatio}
            onChange={(v) => updateData({ aspectRatio: v })}
            leadingIcon={<AspectRatioGlyph ratio={data.aspectRatio} />}
            optionIcon={(ratio) => <AspectRatioGlyph ratio={ratio} />}
          />
        </div>
        <div className={glassStyles.field}>
          <NodeSelect
            options={durationOptions}
            value={`${selectedDuration}s`}
            onChange={(v) => updateData({ duration: Number.parseInt(v, 10) || 5 })}
            leadingIcon={<Clock3 size={10} />}
            optionIcon={() => <Clock3 size={10} />}
          />
        </div>
        <div className={glassStyles.field}>
          <NodeSelect
            options={resolutionOptions}
            value={selectedResolution}
            onChange={(v) => updateData({ videoResolution: v as VideoResolution })}
            leadingIcon={<Image src="/node-icons/icon-resolution.svg" alt="" width={10} height={10} aria-hidden />}
            optionIcon={() => <Image src="/node-icons/icon-resolution.svg" alt="" width={10} height={10} aria-hidden />}
            locked={!!lockedResolution}
          />
        </div>
      </div>

      {/* Frame reference slots */}
      <div className={glassStyles.referenceSection}>
        <label className={glassStyles.microLabel}>Frame References</label>
        <div className={glassStyles.connectorRows}>
          <ReferenceInputRow ref={startFrameRowRef} nodeId={id} edgeId={startFrameEdge?.id}
            label="Start Frame" connected={!!startFrameEdge || !!data.startFrameUrl}
            canReorder={supportsEndFrame && !!startFrameEdge && !!endFrameEdge} compact>
            {data.startFrameUrl && <CanvasImage src={data.startFrameUrl} alt="Start frame" draggable={false}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
          </ReferenceInputRow>
          {supportsEndFrame && (
            <ReferenceInputRow ref={endFrameRowRef} nodeId={id} edgeId={endFrameEdge?.id}
              label="End Frame" connected={!!endFrameEdge || !!data.endFrameUrl}
              canReorder={!!startFrameEdge && !!endFrameEdge} compact>
              {data.endFrameUrl && <CanvasImage src={data.endFrameUrl} alt="End frame" draggable={false}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
            </ReferenceInputRow>
          )}
        </div>
      </div>

      {/* Video history navigation */}
      {videoHistory.length > 1 && (
        <div className={glassStyles.historyNav}>
          <button
            onClick={() => navigateHistory(Math.max(0, histIdx - 1))}
            disabled={histIdx === 0}
            className="flex items-center p-0.5 rounded transition-opacity disabled:opacity-30 nodrag"
            style={{ color: 'var(--color-white-muted)' }}
          >
            <ChevronLeft size={13} />
          </button>
          <span
            className={glassStyles.microLabel}
            style={{ color: histIdx < videoHistory.length - 1 ? 'var(--color-accent)' : undefined }}
          >
            {`VERSION ${histIdx + 1}`}
          </span>
          <button
            onClick={() => navigateHistory(Math.min(videoHistory.length - 1, histIdx + 1))}
            disabled={histIdx === videoHistory.length - 1}
            className="flex items-center p-0.5 rounded transition-opacity disabled:opacity-30 nodrag"
            style={{ color: 'var(--color-white-muted)' }}
          >
            <ChevronRight size={13} />
          </button>
        </div>
      )}

      {hasFailure && (
        <div
          className={glassStyles.mediaFrame}
          style={{ aspectRatio: videoAspect, borderColor: 'var(--color-error)' }}
        >
          <GenerationFailureOverlay
            message={data.errorMessage}
            requestId={data.errorRequestId}
          />
        </div>
      )}

      <GenerationPreview
        pending={isGenerating || data.status === 'processing'}
        failed={hasFailure}
        resultSrc={displayVideoUrl}
        kind="video"
        aspectRatio={videoAspect}
      >
        {displayVideoUrl && (
          <div className={glassStyles.mediaFrame}>
            <CanvasVideo
              src={displayVideoUrl}
              preview
              className="w-full block nodrag"
              style={{ aspectRatio: videoAspect }}
            />
          </div>
        )}
      </GenerationPreview>

      <TypedHandle
        type="source"
        position={Position.Right}
        id="video"
        portType="video"
        connected={storeEdges.some(e => e.source === id && e.sourceHandle === 'video')}
      />
    </NodeWrapper>
  );
}
