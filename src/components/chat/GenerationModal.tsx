'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Download, Trash2 } from 'lucide-react';
import type { Generation } from '@/types';
import { formatDate } from '@/lib/utils/date';
import { downloadFromUrl } from '@/lib/utils/download';
import { resolveMediaUrl } from '@/lib/utils/mediaUtils';
import { ProgressiveImage } from '@/components/ui/ProgressiveImage';

function formatFalCostUsd(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 0.01 ? 4 : 2,
  }).format(value);
}

function getFalCostUsd(generation: Generation): number | null | undefined {
  if (generation.fal_cost_usd !== null && generation.fal_cost_usd !== undefined) {
    return generation.fal_cost_usd;
  }

  const falBilling = generation.parameters?.falBilling;
  if (!falBilling || typeof falBilling !== 'object' || Array.isArray(falBilling)) return null;

  const costUsd = (falBilling as { costUsd?: unknown }).costUsd;
  return typeof costUsd === 'number' ? costUsd : null;
}

export function GenerationModal({
  generation,
  onClose,
  onDelete,
}: {
  generation: Generation;
  onClose: () => void;
  onDelete: (g: Generation) => void;
}) {
  const isVideo = generation.media_type === 'video';
  const [expanded, setExpanded] = useState(false);
  const [mediaUrl, setMediaUrl] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    resolveMediaUrl(generation.media_url).then(url => { if (!cancelled) setMediaUrl(url); });
    return () => { cancelled = true; };
  }, [generation.media_url]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  const PROMPT_LIMIT = 140;
  const fullPrompt = generation.prompt ?? '';
  const isLong = fullPrompt.length > PROMPT_LIMIT;
  const shownPrompt = isLong && !expanded ? fullPrompt.slice(0, PROMPT_LIMIT) + '…' : fullPrompt;
  const falCost = formatFalCostUsd(getFalCostUsd(generation));

  const details = [
    { label: 'Model',  value: generation.model },
    { label: 'Type',   value: generation.media_type },
    { label: 'Date',   value: formatDate(generation.created_at) },
    ...(falCost ? [{ label: 'Final cost', value: falCost, icon: '$' }] : []),
    ...(generation.width && generation.height
      ? [{ label: 'Size', value: `${generation.width} × ${generation.height}` }]
      : []),
  ];

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Generation details"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
        if (event.key === 'Tab') {
          const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button, video[controls]');
          if (!controls?.length) return;
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
            event.preventDefault(); last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first.focus();
          }
        }
      }}
      className="fixed inset-0 z-50 flex flex-col sm:flex-row outline-none"
      style={{ background: '#000' }}
      onClick={onClose}
    >
      {/* Left: media */}
      <div
        className="flex-1 flex items-center justify-center min-w-0 min-h-0 p-4 sm:p-10"
        onClick={(e) => e.stopPropagation()}
      >
        {mediaUrl && (isVideo ? (
          <video
            src={mediaUrl}
            controls
            className="max-w-full rounded-xl object-contain"
            style={{ maxHeight: '100%', width: '100%', height: '100%' }}
          />
        ) : (
          <ProgressiveImage
            src={mediaUrl}
            alt={generation.prompt ?? ''}
            containerStyle={{ width: '100%', height: '100%' }}
            className="max-w-full rounded-xl object-contain"
            style={{ maxHeight: '100%', width: '100%', height: '100%' }}
          />
        ))}
      </div>

      {/* Right: info panel */}
      <div
        className="w-full sm:w-80 max-h-[45dvh] sm:max-h-none flex-shrink-0 flex flex-col overflow-y-auto"
        style={{ background: 'var(--color-bg-elevated)', borderLeft: '1px solid rgba(255,255,255,0.08)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Panel top bar */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
        >
          <span
            className="text-xs px-2.5 py-1 rounded-full capitalize font-medium"
            style={{ background: 'rgba(255,255,255,0.07)', color: 'var(--color-white-muted)' }}
          >
            {generation.media_type}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="p-1.5 rounded-lg transition-opacity hover:opacity-70"
            style={{ background: 'rgba(255,255,255,0.12)', color: '#fff', border: 'none', cursor: 'pointer' }}
            title="Close"
          >
            <X size={15} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="p-5 flex flex-col gap-5 flex-1">
          {/* Model + date */}
          <div>
            <h2 className="text-lg font-semibold leading-tight" style={{ color: 'var(--color-white)' }}>
              {generation.model}
            </h2>
            <p className="text-sm mt-1" style={{ color: 'var(--color-white-muted)' }}>
              {formatDate(generation.created_at)}
            </p>
          </div>

          {/* Prompt */}
          {fullPrompt && (
            <div>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--color-white)', overflowWrap: 'anywhere' }}>
                {shownPrompt}
              </p>
              {isLong && (
                <button
                  onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
                  className="text-xs mt-1.5 transition-opacity hover:opacity-60"
                  style={{ color: 'var(--color-white-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  {expanded ? 'less' : 'more'}
                </button>
              )}
            </div>
          )}

          {/* Download — white pill */}
          <button
            onClick={(e) => { e.stopPropagation(); downloadFromUrl(mediaUrl); }}
            disabled={!mediaUrl}
            className="flex items-center justify-center gap-2 py-2.5 rounded-full text-sm font-semibold transition-opacity hover:opacity-85"
            style={{ background: '#fff', color: '#000', border: 'none', cursor: 'pointer' }}
          >
            <Download size={14} />
            Download
          </button>

          {/* Details list */}
          <div>
            <p
              className="text-xs font-semibold uppercase tracking-wider mb-3"
              style={{ color: 'var(--color-white-muted)' }}
            >
              {String(details.length).padStart(2, '0')} Details
            </p>
            <div className="space-y-3">
              {details.map(({ label, value, icon }) => (
                <div key={label} className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-semibold"
                    style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--color-white-muted)' }}
                  >
                    {icon ?? label[0]}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate" style={{ color: 'var(--color-white)' }}>{value}</p>
                    <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>{label}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Panel bottom bar — delete */}
        <div
          className="px-5 py-4"
          style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(generation); }}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-full text-sm font-semibold transition-opacity hover:opacity-85"
            style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: 'none', cursor: 'pointer' }}
            title="Delete"
          >
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
