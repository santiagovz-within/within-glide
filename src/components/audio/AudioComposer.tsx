'use client';

import { useLayoutEffect, useRef } from 'react';
import { AlertTriangle, Clock3, FileAudio, ListMusic, Loader2, Music, Sparkles, X } from 'lucide-react';
import { ModelSelect } from '@/components/canvas/nodes/ModelSelect';
import { NodeSelect } from '@/components/canvas/nodes/NodeSelect';
import { MUSIC_MODELS, getMusicModel, musicLengthOptions, musicFormatLabel, estimateMusicCost } from '@/lib/api/music';
import { formatFalCostEstimate } from '@/lib/falPricing';
import { useAudioStore } from '@/lib/stores/audioStore';
import { cn } from '@/lib/utils/cn';
import glass from '@/components/canvas/nodes/ImageGenerationGlass.module.css';
import styles from '@/components/chat/ImageVideo.module.css';
import audio from './Audio.module.css';

function lengthLabel(seconds: number) {
  return seconds < 60 ? `${seconds} sec` : `${Math.floor(seconds / 60)} min${seconds % 60 ? ` ${seconds % 60} sec` : ''}`;
}

export function AudioComposer({ onSubmit, disabled = false }: { onSubmit: () => void; disabled?: boolean }) {
  const { prompt, setPrompt, settings, updateSettings, setModel, isSubmitting, error } = useAudioStore();
  const model = getMusicModel(settings.model) ?? MUSIC_MODELS[0];
  const lengths = musicLengthOptions(model.id);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const tooLong = !!model.maxPromptLength && prompt.length > model.maxPromptLength;
  const locked = disabled || isSubmitting;
  const canGenerate = !locked && !!prompt.trim() && !tooLong && (!model.requiresLyrics || !!settings.lyrics?.trim());
  const estimate = formatFalCostEstimate(estimateMusicCost(model.id, settings.duration, settings.numSounds));

  useLayoutEffect(() => {
    if (!textarea.current) return;
    textarea.current.style.height = 'auto';
    textarea.current.style.height = `${textarea.current.scrollHeight}px`;
  }, [prompt]);

  return (
    <div className={cn(glass.nodeSurface, glass.glassSurface, styles.composer)}>
      <div className={styles.promptRow}>
        <Music size={20} className={audio.promptIcon} aria-hidden />
        <textarea ref={textarea} className={styles.prompt} aria-label="Audio prompt" rows={2}
          placeholder="Describe the mood, genre, instruments, vocals…" value={prompt} readOnly={isSubmitting}
          maxLength={model.maxPromptLength} onChange={event => setPrompt(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (canGenerate) onSubmit();
            }
          }} />
      </div>
      {(error || tooLong) && <div className={styles.error} role="alert">
        <AlertTriangle size={14} /><span>{tooLong ? `Shorten your prompt to ${model.maxPromptLength} characters for ${model.name}.` : error}</span>
        {error && <button onClick={() => useAudioStore.setState({ error: '' })} aria-label="Dismiss error"><X size={14} /></button>}
      </div>}
      {model.requiresLyrics && <label className="flex flex-col gap-2 px-4 pb-3 text-xs">
        Lyrics
        <textarea aria-label="Lyrics" value={settings.lyrics ?? ''} readOnly={locked}
          onChange={event => updateSettings({ lyrics: event.target.value })} rows={4}
          placeholder={'[verse]\nWrite your lyrics here\n[chorus]\nWrite your chorus here'}
          className="w-full rounded-lg p-3 outline-none" style={{ background: 'var(--color-bg-surface)' }} />
        <span style={{ color: 'var(--color-white-muted)' }}>Use section tags such as [verse] and [chorus] on their own lines.</span>
      </label>}
      {model.durationMode && <p className="px-4 pb-3 text-xs" style={{ color: 'var(--color-white-muted)' }}>
        {model.durationMode === 'prompt'
          ? 'Describe length and structure in your prompt, for example “a two-minute track”. Exact length may vary.'
          : 'The song may finish before the maximum length.'}
      </p>}
      <div className={styles.controls}>
        <div className={styles.model}>
          <ModelSelect standalone size="large" compact placement="top" label="Music model" options={[...MUSIC_MODELS]}
            value={model.id} onChange={setModel} disabled={locked} />
        </div>
        {model.durationMode !== 'prompt' && <NodeSelect standalone size="large" placement="top" label={model.durationMode === 'maximum' ? 'Maximum music length' : 'Music length'} locked={locked}
          options={lengths.map(lengthLabel)} value={lengthLabel(settings.duration)} leadingIcon={<Clock3 size={14} />}
          onChange={value => updateSettings({ duration: lengths.find(length => lengthLabel(length) === value)! })} />}
        <NodeSelect standalone size="large" placement="top" label="Sounds per batch" locked={locked}
          options={Array.from({ length: model.maxBatchSize }, (_, i) => `${i + 1} ${i === 0 ? 'sound' : 'sounds'}`)}
          value={`${settings.numSounds} ${settings.numSounds === 1 ? 'sound' : 'sounds'}`} leadingIcon={<ListMusic size={14} />}
          onChange={value => updateSettings({ numSounds: Number.parseInt(value, 10) })} />
        <div className={audio.format}>
          <NodeSelect standalone size="large" placement="top" label="Audio output format" locked={locked || model.formats.length === 1}
            options={model.formats.map(musicFormatLabel)} value={musicFormatLabel(settings.outputFormat)} leadingIcon={<FileAudio size={14} />}
            onChange={value => updateSettings({ outputFormat: model.formats.find(format => musicFormatLabel(format) === value)! })} />
        </div>
        <div className={styles.actions}>
          <button className={cn(glass.glassSurface, glass.button, glass.generateButton, styles.generate)}
            onClick={onSubmit} disabled={!canGenerate} title={model.billingDescription}>
            <span className={cn(glass.glassContent, styles.generateContent)}>
              {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {isSubmitting ? 'Submitting…' : 'Generate'}
              <span className={audio.cost}>{estimate}</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
