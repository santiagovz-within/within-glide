'use client';

import { Clock3, ListMusic } from 'lucide-react';
import type { MusicGenNodeData } from '@/types';
import { MUSIC_MODELS, getMusicModel, musicLengthOptions, musicFormatLabel } from '@/lib/api/music';
import { cn } from '@/lib/utils/cn';
import { ModelSelect } from './ModelSelect';
import { NodeSelect } from './NodeSelect';
import styles from './ImageGenerationGlass.module.css';

function lengthLabel(seconds: number) {
  return seconds < 60 ? `${seconds} sec` : `${Math.floor(seconds / 60)} min${seconds % 60 ? ` ${seconds % 60} sec` : ''}`;
}

/** Model-specific controls for the canvas music node. */
export function MusicSettings({ data, update, busy = false, standalone = false }: {
  data: MusicGenNodeData; update: (changes: Partial<MusicGenNodeData>) => void;
  busy?: boolean; standalone?: boolean;
}) {
  const model = getMusicModel(data.model) ?? MUSIC_MODELS[0];
  const lengths = musicLengthOptions(model.id);
  return <>
      <ModelSelect standalone={standalone} label="Music model" options={[...MUSIC_MODELS]} value={model.id} disabled={busy}
        onChange={modelId => {
          if (busy) return;
          const next = getMusicModel(modelId)!;
          update({ model: next.id, duration: musicLengthOptions(next.id).includes(data.duration) ? data.duration : next.defaultDuration,
            numSounds: Math.min(data.numSounds, next.maxBatchSize), outputFormat: next.defaultFormat });
        }} />
      {model.requiresLyrics && <label className="flex flex-col gap-2 text-xs">
        Lyrics
        <textarea aria-label="Lyrics" value={data.lyrics ?? ''} readOnly={busy}
          onChange={event => update({ lyrics: event.target.value })} rows={5}
          placeholder={'[verse]\nWrite your lyrics here\n[chorus]\nWrite your chorus here'}
          className="nodrag nowheel w-full rounded-lg p-3 outline-none" style={{ background: 'var(--color-bg-surface)' }} />
        <span style={{ color: 'var(--color-white-muted)' }}>Use section tags such as [verse] and [chorus] on their own lines.</span>
      </label>}
      {model.durationMode === 'prompt' && <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>
        Describe the length and song structure in your prompt, for example “a two-minute track”. Exact length may vary.
      </p>}
      {model.durationMode === 'maximum' && <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>
        The song may finish before the maximum length.
      </p>}
      <div className={styles.selectRow}>
        {model.durationMode !== 'prompt' && <div className={cn(styles.field, 'min-w-0')}>
          <span className={styles.microLabel}>{model.durationMode === 'maximum' ? 'Maximum length' : 'Length'}</span>
          <NodeSelect standalone={standalone} label="Music length" placement="top" options={lengths.map(lengthLabel)} value={lengthLabel(data.duration)} locked={busy}
            leadingIcon={<Clock3 size={10} />} optionIcon={() => <Clock3 size={10} />}
            onChange={value => update({ duration: lengths.find(length => lengthLabel(length) === value)! })} />
        </div>}
        <div className={cn(styles.field, 'min-w-0')}>
          <span className={styles.microLabel}>Sounds per batch</span>
          <NodeSelect standalone={standalone} label="Sounds per batch" options={Array.from({ length: model.maxBatchSize }, (_, i) => String(i + 1))}
            leadingIcon={<ListMusic size={10} />} optionIcon={() => <ListMusic size={10} />}
            value={String(data.numSounds)} locked={busy} onChange={value => update({ numSounds: Number(value) })} />
        </div>
      </div>
      <div className={cn(styles.field, 'min-w-0')}>
        <span className={styles.microLabel}>Output format</span>
        <NodeSelect standalone={standalone} label="Audio output format" placement="top" options={model.formats.map(musicFormatLabel)} value={musicFormatLabel(data.outputFormat)}
          locked={busy || model.formats.length === 1} onChange={value => update({ outputFormat: model.formats.find(format => musicFormatLabel(format) === value)! })} />
      </div>
  </>;
}
