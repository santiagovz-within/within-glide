'use client';

import { Download } from 'lucide-react';
import { downloadFromUrl } from '@/lib/utils/download';
import { isRawMusicUrl } from '@/lib/api/music';

export function AudioTrack({ url, label = 'Music track' }: { url: string; label?: string }) {
  return <div className="nodrag nopan nowheel flex w-full min-w-0 flex-col gap-2 py-2" onClick={event => event.stopPropagation()}>
    {isRawMusicUrl(url) ? <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>Raw audio — download to listen in an audio editor.</p>
      : <audio aria-label={label} src={url} controls preload="none" className="w-full min-w-0 max-w-full" />}
    <button aria-label={`Download ${label}`} className="flex items-center justify-center gap-1 text-xs hover:opacity-70"
      onClick={() => downloadFromUrl(url)}><Download size={12} /> Download</button>
  </div>;
}
