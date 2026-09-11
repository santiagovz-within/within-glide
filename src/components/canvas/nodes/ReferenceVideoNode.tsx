'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { Position, type NodeProps } from '@xyflow/react';
import { ChevronLeft, ChevronRight, Clock3, Download, Film, Video, X } from 'lucide-react';
import type { ReferenceVideoNodeData } from '@/types';
import { buildReferenceVideoInput, getReferenceVideoModel, REFERENCE_VIDEO_MODELS, referenceDurationOptions } from '@/lib/api/referenceVideo';
import { useFlowStore } from '@/lib/stores/flowStore';
import { generationJobId, useGenerationStore } from '@/lib/stores/generationStore';
import { startTrackedVideoGeneration } from '@/lib/generationTracker';
import { downloadFromUrl } from '@/lib/utils/download';
import { cn } from '@/lib/utils/cn';
import { CanvasImage, CanvasVideo } from '../CanvasMedia';
import { getReferenceVideoInputs, REFERENCE_IMAGE_HANDLE, REFERENCE_VIDEO_HANDLE } from '../referenceVideoInputs';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import { ModelSelect } from './ModelSelect';
import { NodeSelect } from './NodeSelect';
import { AspectRatioGlyph } from './AspectRatioGlyph';
import { GenerationPreview } from './GenerationPreview';
import { GenerationFailureOverlay, RegenerateGate } from './GenerationFailure';
import glassStyles from './ImageGenerationGlass.module.css';

export function ReferenceVideoNode({ data, selected, id }: NodeProps & { data: ReferenceVideoNodeData }) {
  const currentFlow = useFlowStore(state => state.currentFlow);
  const nodes = useFlowStore(state => state.nodes);
  const edges = useFlowStore(state => state.edges);
  const activeJobId = currentFlow ? generationJobId(currentFlow.id, id) : '';
  const isGenerating = useGenerationStore(state => !!state.jobs[activeJobId]);
  const config = getReferenceVideoModel(data.model) ?? REFERENCE_VIDEO_MODELS[0];
  const references = getReferenceVideoInputs(id, nodes, edges);
  const durationOptions = referenceDurationOptions(config);
  const duration = durationOptions.includes(data.referenceDuration ?? config.defaultDuration)
    ? data.referenceDuration ?? config.defaultDuration : config.defaultDuration;
  const aspectRatio = config.aspectRatios.includes(data.aspectRatio) ? data.aspectRatio : config.defaultAspectRatio;
  const resolution = data.videoResolution && config.resolutions.includes(data.videoResolution)
    ? data.videoResolution : config.defaultResolution;
  const videoHistory = data.videoHistory ?? [];
  const [historyIndex, setHistoryIndex] = useState(Math.max(0, videoHistory.length - 1));
  const [historyLength, setHistoryLength] = useState(videoHistory.length);
  if (historyLength !== videoHistory.length) {
    setHistoryLength(videoHistory.length);
    setHistoryIndex(Math.max(0, videoHistory.length - 1));
  }
  const displayVideoUrl = videoHistory[historyIndex] ?? data.videoUrl;
  const hasFailure = data.status === 'error';
  const videoAspect = aspectRatio.includes(':') ? aspectRatio.replace(':', '/') : '16/9';
  const promptRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLDivElement>(null);
  const [offsets, setOffsets] = useState([50, 220, 280]);

  useLayoutEffect(() => {
    const elements = [promptRef.current, imageRef.current, videoRef.current];
    function measure() {
      const next = elements.map(el => el ? el.offsetTop + el.offsetHeight / 2 : 0);
      setOffsets(previous => previous.every((value, index) => value === next[index]) ? previous : next);
    }
    measure();
    const observer = new ResizeObserver(measure);
    elements.forEach(el => { if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, [config.id, references.images.length, references.videos.length, data.prompt, data.promptConnected]);

  function updateData(updates: Partial<ReferenceVideoNodeData>) {
    document.dispatchEvent(new CustomEvent('node:update', { detail: { nodeId: id, data: updates } }));
  }

  function changeModel(model: string) {
    const next = getReferenceVideoModel(model);
    if (!next) return;
    updateData({
      model,
      aspectRatio: next.aspectRatios.includes(aspectRatio) ? aspectRatio : next.defaultAspectRatio,
      videoResolution: (next.resolutions.includes(resolution) ? resolution : next.defaultResolution) as ReferenceVideoNodeData['videoResolution'],
      referenceDuration: referenceDurationOptions(next).includes(duration) ? duration : next.defaultDuration,
    });
  }

  function generationPayload() {
    return {
      model: config.id, prompt: data.prompt ?? '', generationMode: 'reference-to-video',
      aspectRatio, videoResolution: resolution, referenceDuration: duration,
      generateAudio: data.generateAudio ?? true,
      referenceImageUrls: references.images.map(reference => reference.url),
      referenceVideoUrls: references.videos.map(reference => reference.url),
      sourceType: 'canvas', sourceId: currentFlow?.id, nodeId: id,
    };
  }

  let validationMessage: string | undefined;
  if ([...references.images, ...references.videos].some(reference => !reference.url)) {
    validationMessage = 'A connected reference has no media yet. Upload or generate it before continuing.';
  } else {
    try { buildReferenceVideoInput(generationPayload()); }
    catch (error) { validationMessage = error instanceof Error ? error.message : 'Check the references.'; }
  }

  function generate() {
    if (!currentFlow || isGenerating || validationMessage || hasFailure) return;
    const payload = generationPayload();
    // Recheck immediately before submission, including limits after a model switch.
    const { endpoint } = buildReferenceVideoInput(payload);
    useFlowStore.getState().consumeGcsOnlyEligibility();
    void startTrackedVideoGeneration({
      flowId: currentFlow.id, flowTitle: currentFlow.title, nodeId: id,
      nodeType: 'referenceVideoNode', data, endpoint, payload,
    });
  }

  function navigateHistory(index: number) {
    setHistoryIndex(index);
    const videoUrl = videoHistory[index];
    if (!videoUrl) return;
    useFlowStore.getState().updateNodeData(id, { videoUrl });
    document.dispatchEvent(new CustomEvent('node:video-propagate', { detail: { sourceNodeId: id, videoUrl } }));
  }

  function removeReference(edgeId: string) {
    const store = useFlowStore.getState();
    store.setEdges(store.edges.filter(edge => edge.id !== edgeId));
  }

  const footer = (
    <div className={glassStyles.footerStack}>
      {validationMessage && <p className={cn(glassStyles.microLabel, 'nodrag')} role="status">{validationMessage}</p>}
      <button onClick={generate} disabled={isGenerating || hasFailure || !!validationMessage || !currentFlow}
        className={cn(glassStyles.glassSurface, glassStyles.button, glassStyles.generateButton, 'nodrag disabled:opacity-40')}>
        <span className={cn(glassStyles.glassContent, glassStyles.buttonContent)}>
          <Film size={12} />{isGenerating ? 'Generating…' : 'Generate'}
        </span>
      </button>
      {hasFailure && <RegenerateGate onChangesApplied={() => updateData({ status: 'idle', errorMessage: undefined, errorRequestId: undefined })} />}
      {displayVideoUrl && (
        <button onClick={() => downloadFromUrl(displayVideoUrl)}
          className={cn(glassStyles.glassSurface, glassStyles.button, glassStyles.downloadButton, 'nodrag')}>
          <span className={cn(glassStyles.glassContent, glassStyles.buttonContent)}><Download size={12} />Download</span>
        </button>
      )}
    </div>
  );

  return (
    <NodeWrapper title="Reference to Video" icon={<Video size={14} />} status={data.status}
      errorMessage={data.errorMessage} selected={selected} minWidth={320} accentColor={PORT_COLORS.video}
      titlePosition="outside" appearance="imageGenerationGlass" footer={footer}>
      <TypedHandle type="target" position={Position.Left} id="prompt" portType="text"
        offset={`${offsets[0]}px`} connected={!!data.promptConnected} />
      <TypedHandle type="target" position={Position.Left} id={REFERENCE_IMAGE_HANDLE} portType="image"
        offset={`${offsets[1]}px`} connected={references.images.length > 0} title="Connect image references" />
      <TypedHandle type="target" position={Position.Left} id={REFERENCE_VIDEO_HANDLE} portType="video"
        offset={`${offsets[2]}px`} connected={references.videos.length > 0} title="Connect video references" />

      <div ref={promptRef} className={cn(glassStyles.glassSurface, glassStyles.promptSection,
        glassStyles.promptSurface, data.promptConnected && glassStyles.connectedTextPrompt)}>
        {data.promptConnected ? (
          <div className={cn(glassStyles.glassContent, glassStyles.connectedPrompt)} title={data.prompt}>Prompt connected</div>
        ) : (
          <textarea aria-label="Prompt" rows={3} placeholder="Describe the video and how to use your references…"
            value={data.prompt ?? ''} onChange={event => updateData({ prompt: event.target.value })}
            className={cn(glassStyles.glassContent, glassStyles.promptContent, 'outline-none nodrag nowheel')} />
        )}
      </div>
      <ModelSelect options={REFERENCE_VIDEO_MODELS} value={config.id} onChange={changeModel} />
      {config.audioParam && (
        <div className={glassStyles.rowBetween}>
          <span className={glassStyles.microLabel}>Generate Audio</span>
          <button aria-label="Generate audio" aria-pressed={data.generateAudio ?? true}
            onClick={() => updateData({ generateAudio: !(data.generateAudio ?? true) })}
            className={cn(glassStyles.glassSurface, glassStyles.switch, (data.generateAudio ?? true) && glassStyles.switchOn, 'nodrag')}>
            <span className={cn(glassStyles.glassContent, glassStyles.switchKnob)} />
          </button>
        </div>
      )}
      <div className={glassStyles.grid3}>
        <NodeSelect label="Aspect ratio" options={config.aspectRatios} value={aspectRatio}
          onChange={value => updateData({ aspectRatio: value })} leadingIcon={<AspectRatioGlyph ratio={aspectRatio} />} />
        <NodeSelect label="Seconds to generate" options={durationOptions.map(value => value === 'auto' ? 'Auto' : `${value}s`)}
          value={duration === 'auto' ? 'Auto' : `${duration}s`} leadingIcon={<Clock3 size={10} />}
          onChange={value => updateData({ referenceDuration: value === 'Auto' ? 'auto' : Number.parseInt(value, 10) })} />
        <NodeSelect label="Resolution" options={config.resolutions} value={resolution}
          onChange={value => updateData({ videoResolution: value as ReferenceVideoNodeData['videoResolution'] })} />
      </div>
      <p className={cn(glassStyles.microLabel, 'nodrag')} style={{ textTransform: 'none' }}>{config.referenceHint}</p>

      {(['image', 'video'] as const).map(kind => {
        const items = kind === 'image' ? references.images : references.videos;
        const limit = kind === 'image' ? config.maxImages : config.maxVideos;
        const referenceLabel = (index: number) => config.id === 'google-omni-flash'
          ? `<${kind.toUpperCase()}_REF_${index}>`
          : `${config.id.startsWith('seedance') ? '@' : ''}${kind === 'image' ? 'Image' : 'Video'}${config.id.startsWith('seedance') ? '' : ' '}${index + 1}`;
        return (
          <div key={kind} className={glassStyles.referenceSection}>
            <div ref={kind === 'image' ? imageRef : videoRef}
              className={cn(glassStyles.glassSurface, glassStyles.connector, items.length ? glassStyles.connectorActive : glassStyles.connectorInactive)}>
              <span className={glassStyles.glassContent}>{kind === 'image' ? 'Image' : 'Video'} References ({items.length}/{limit})</span>
            </div>
            {items.length === 0 && <p className={glassStyles.microLabel}>Connect {kind} outputs to the port.</p>}
            {items.map((item, index) => (
              <div key={item.edgeId} className={cn(glassStyles.rowBetween, 'nodrag')}>
                <div style={{ width: 48, height: 36, overflow: 'hidden', borderRadius: 5 }}>
                  {item.url && (kind === 'image'
                    ? <CanvasImage src={item.url} alt={`Image ${index + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <CanvasVideo src={item.url} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />)}
                </div>
                <span className={glassStyles.microLabel} style={{ textTransform: 'none' }}>{referenceLabel(index)}{!item.url ? ' · Waiting for media' : ''}</span>
                <button aria-label={`Remove ${kind} reference ${index + 1}`} onClick={() => removeReference(item.edgeId)} className="nodrag p-1"><X size={12} /></button>
              </div>
            ))}
            {kind === 'video' && <p className={cn(glassStyles.microLabel, 'nodrag')} style={{ textTransform: 'none' }}>{config.videoHint}</p>}
          </div>
        );
      })}

      {videoHistory.length > 1 && (
        <div className={glassStyles.historyNav}>
          <button aria-label="Previous version" onClick={() => navigateHistory(historyIndex - 1)} disabled={historyIndex === 0} className="nodrag disabled:opacity-30"><ChevronLeft size={13} /></button>
          <span className={glassStyles.microLabel}>VERSION {historyIndex + 1}</span>
          <button aria-label="Next version" onClick={() => navigateHistory(historyIndex + 1)} disabled={historyIndex >= videoHistory.length - 1} className="nodrag disabled:opacity-30"><ChevronRight size={13} /></button>
        </div>
      )}
      {hasFailure && (
        <div className={glassStyles.mediaFrame} style={{ aspectRatio: videoAspect }}>
          <GenerationFailureOverlay message={data.errorMessage} requestId={data.errorRequestId} />
        </div>
      )}
      <GenerationPreview pending={isGenerating || data.status === 'processing'} failed={hasFailure}
        resultSrc={displayVideoUrl} kind="video" aspectRatio={videoAspect}>
        {displayVideoUrl && <div className={glassStyles.mediaFrame}><CanvasVideo src={displayVideoUrl} controls className="w-full block nodrag" style={{ aspectRatio: videoAspect }} /></div>}
      </GenerationPreview>
      <TypedHandle type="source" position={Position.Right} id="video" portType="video"
        connected={edges.some(edge => edge.source === id && edge.sourceHandle === 'video')} />
    </NodeWrapper>
  );
}
