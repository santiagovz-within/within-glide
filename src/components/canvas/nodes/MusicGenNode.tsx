'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Position, type NodeProps } from '@xyflow/react';
import { Clock3, Download, ListMusic, Music } from 'lucide-react';
import type { MusicGenNodeData } from '@/types';
import { useFlowStore } from '@/lib/stores/flowStore';
import { useGenerationStore, generationJobId } from '@/lib/stores/generationStore';
import { startTrackedMusicGeneration } from '@/lib/generationTracker';
import { MUSIC_MODELS, getMusicModel, musicLengthOptions, musicFormatLabel, estimateMusicCost } from '@/lib/api/music';
import { formatFalCostEstimate } from '@/lib/falPricing';
import { downloadAllFromUrls } from '@/lib/utils/download';
import { cn } from '@/lib/utils/cn';
import { NodeWrapper } from './NodeWrapper';
import { NodeSelect } from './NodeSelect';
import { ModelSelect } from './ModelSelect';
import { DisconnectInputButton } from './DisconnectInputButton';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import { AudioTrack } from './AudioTrack';
import styles from './ImageGenerationGlass.module.css';

function lengthLabel(seconds: number) {
  return seconds < 60 ? `${seconds} sec` : `${Math.floor(seconds / 60)} min${seconds % 60 ? ` ${seconds % 60} sec` : ''}`;
}

export function MusicGenNode({ data, selected, id }: NodeProps & { data: MusicGenNodeData }) {
  const flow = useFlowStore(state => state.currentFlow);
  const edges = useFlowStore(state => state.edges);
  const job = useGenerationStore(state => flow ? state.jobs[generationJobId(flow.id, id)] : undefined);
  const model = getMusicModel(data.model) ?? MUSIC_MODELS[0];
  const busy = !!job || data.status === 'processing';
  const promptEdge = edges.find(edge => edge.target === id && edge.targetHandle === 'prompt');
  const connected = !!promptEdge;
  const promptSectionRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [promptHandleTop, setPromptHandleTop] = useState(40);
  const lengths = musicLengthOptions(model.id);
  const audios = data.generatedAudios ?? [];
  const slots = data.generationSlots ?? audios;
  const previousBatches = (data.generationHistory ?? []).filter(batch => batch.join() !== audios.join());
  const estimate = formatFalCostEstimate(estimateMusicCost(model.id, data.duration, data.numSounds));
  const update = (updates: Partial<MusicGenNodeData>) => useFlowStore.getState().updateNodeData(id, updates);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
    const section = promptSectionRef.current;
    if (section) setPromptHandleTop(section.offsetTop + section.offsetHeight / 2);
  }, [data.prompt, connected]);

  async function generate() {
    if (busy || !flow || !data.prompt?.trim()) return;
    useFlowStore.getState().consumeGcsOnlyEligibility();
    await startTrackedMusicGeneration({
      flowId: flow.id, flowTitle: flow.title, nodeId: id, data, endpoint: '/api/fal/music', slotCount: data.numSounds,
      payload: { model: model.id, prompt: data.prompt, duration: data.duration, outputFormat: data.outputFormat,
        sourceType: 'canvas', sourceId: flow.id, nodeId: id },
    });
  }

  return (
    <NodeWrapper title="Music Generation" icon={<Music size={14} />} status={data.status}
      errorMessage={data.errorMessage} selected={selected} minWidth={300} accentColor={PORT_COLORS.audio}
      titlePosition="outside" appearance="imageGenerationGlass"
      footer={<div className={styles.footerStack}>
        <button onClick={generate} disabled={busy || !flow || !data.prompt?.trim()}
          className={cn(styles.glassSurface, styles.button, styles.generateButton, 'nodrag transition-opacity disabled:opacity-40')}>
          <span className={cn(styles.glassContent, styles.buttonContent)}>
            <Image src="/node-icons/icon-generate.svg" alt="" width={11} height={11} aria-hidden /> {busy ? 'Generating…' : 'Generate'}
            <span className={styles.costEstimate} title={model.billingDescription}>{estimate}</span>
          </span>
        </button>
        {audios.length > 0 && <button onClick={() => downloadAllFromUrls(audios, 'music')}
          className={cn(styles.glassSurface, styles.button, styles.downloadButton, 'nodrag transition-opacity hover:opacity-80 active:opacity-60')}>
          <span className={cn(styles.glassContent, styles.buttonContent)}><Download size={12} /> Download {audios.length > 1 ? 'batch' : 'track'}</span>
        </button>}
      </div>}>
      <TypedHandle type="target" position={Position.Left} id="prompt" portType="text" offset={`${promptHandleTop}px`} connected={connected} />
      <TypedHandle type="source" position={Position.Right} id="audio" portType="audio"
        connected={edges.some(edge => edge.source === id && edge.sourceHandle === 'audio')} />
      {connected ? (
        <div ref={promptSectionRef} className={cn(styles.glassSurface, styles.promptSection,
          styles.promptSurface, styles.connectedTextPrompt)}>
          <div className={cn(styles.glassContent, styles.connectedPrompt)}>
            Prompt connected
            <DisconnectInputButton edgeId={promptEdge.id} label="prompt" style={{ height: 20 }} />
          </div>
        </div>
      ) : (
        <div ref={promptSectionRef} className={cn(styles.glassSurface, styles.promptSection, styles.promptSurface)}>
          <textarea ref={textareaRef} aria-label="Music prompt" value={data.prompt ?? ''} readOnly={busy}
            maxLength={model.maxPromptLength} onChange={event => update({ prompt: event.target.value })}
            placeholder="Describe the mood, genre, instruments, vocals…" rows={2}
            className={cn(styles.glassContent, styles.promptContent, 'outline-none nodrag')} />
        </div>
      )}
      <ModelSelect label="Music model" options={[...MUSIC_MODELS]} value={model.id} disabled={busy}
        onChange={modelId => {
          if (busy) return;
          const next = getMusicModel(modelId)!;
          update({ model: next.id, duration: musicLengthOptions(next.id).includes(data.duration) ? data.duration : next.defaultDuration,
            numSounds: Math.min(data.numSounds, next.maxBatchSize), outputFormat: next.defaultFormat });
        }} />
      <div className={styles.selectRow}>
        <div className={cn(styles.field, 'min-w-0')}>
          <span className={styles.microLabel}>Length</span>
          <NodeSelect label="Music length" placement="top" options={lengths.map(lengthLabel)} value={lengthLabel(data.duration)} locked={busy}
            leadingIcon={<Clock3 size={10} />} optionIcon={() => <Clock3 size={10} />}
            onChange={value => update({ duration: lengths.find(length => lengthLabel(length) === value)! })} />
        </div>
        <div className={cn(styles.field, 'min-w-0')}>
          <span className={styles.microLabel}>Sounds per batch</span>
          <NodeSelect label="Sounds per batch" options={Array.from({ length: model.maxBatchSize }, (_, i) => String(i + 1))}
            leadingIcon={<ListMusic size={10} />} optionIcon={() => <ListMusic size={10} />}
            value={String(data.numSounds)} locked={busy} onChange={value => update({ numSounds: Number(value) })} />
        </div>
      </div>
      <div className={cn(styles.field, 'min-w-0')}>
        <span className={styles.microLabel}>Output format</span>
        <NodeSelect label="Audio output format" placement="top" options={model.formats.map(musicFormatLabel)} value={musicFormatLabel(data.outputFormat)}
          locked={busy || model.formats.length === 1} onChange={value => update({ outputFormat: model.formats.find(format => musicFormatLabel(format) === value)! })} />
      </div>
      <div className={cn(styles.previewList, 'min-w-0')}>
        {slots.length ? slots.map((url, index) => <div key={url ?? index} className="w-full min-w-0 rounded-lg p-2" style={{ background: 'var(--color-bg-surface)' }}>
          <span className={styles.microLabel}>Track {index + 1}</span>
          {url ? <AudioTrack url={url} label={`Track ${index + 1}`} /> : <p className="text-xs py-2 break-words" role="status">
            {data.generationErrors?.[index]?.message ?? (busy ? 'Generating music…' : 'No track returned.')}
          </p>}
        </div>) : <div className={styles.emptyState}><Music size={24} /> Your music will appear here</div>}
        {previousBatches.length > 0 && <details className="nodrag nowheel w-full min-w-0 text-xs">
          <summary className="cursor-pointer">Previous batches</summary>
          <div className="flex w-full min-w-0 flex-col gap-2 max-h-64 overflow-y-auto pt-2">
            {previousBatches.slice().reverse().map((batch, index) =>
              <div key={index}>{batch.map((url, track) => <AudioTrack key={url} url={url} label={`Previous track ${track + 1}`} />)}</div>)}
          </div>
        </details>}
      </div>
    </NodeWrapper>
  );
}
