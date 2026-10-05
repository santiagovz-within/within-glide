'use client';

import { useEffect, useState } from 'react';
import { BarChart2, RefreshCw, Image, Film } from 'lucide-react';
import { SPENDING_PERIODS, spendingWindow, type UserSpendingData } from '@/lib/adminSpending';
import styles from './usage.module.css';
import SpendingCalendar from './SpendingCalendar';

interface UsageData {
  totalGenerations: number;
  modelUsage: { model: string; count: number }[];
  userUsage: { userId: string; username: string; count: number }[];
  nodeUsage: { nodeType: string; count: number }[];
  hourlyTraffic: { nyc: number[]; mexico: number[]; bogota: number[] };
  mediaTypeSplit: { image: number; video: number };
}

const NODE_LABELS: Record<string, string> = {
  promptNode:        'Prompt',
  imageInputNode:    'Image Input',
  imageToPromptNode: 'Image to Prompt',
  imageGenNode:      'Image Generation',
  videoGenNode:      'Video Generation',
  referenceVideoNode: 'Reference to Video',
  upscaleNode:       'Upscale',
  modifyNode:        'Modify',
  selectNode:        'Select',
  removeBgNode:      'Remove Background',
  videoToGifNode:    'Video to GIF',
  outputNode:        'Output',
  galleryOutputNode: 'Output Gallery',
  groupNode:         'Group',
};

const NODE_COLORS: Record<string, string> = {
  promptNode:        '#3b9eff',
  imageInputNode:    '#a855f7',
  imageToPromptNode: '#8b5cf6',
  imageGenNode:      '#a855f7',
  videoGenNode:      '#34d399',
  referenceVideoNode: '#34d399',
  upscaleNode:       '#f59e0b',
  modifyNode:        '#fb923c',
  selectNode:        '#60a5fa',
  removeBgNode:      '#f472b6',
  videoToGifNode:    '#4ade80',
  outputNode:        '#94a3b8',
  galleryOutputNode: '#cbd5e1',
  groupNode:         '#64748b',
};

// Deterministic per-model colors
const MODEL_COLOR_MAP: Record<string, string> = {
  'nano-banana-2':   '#a855f7',
  'nano-banana-pro': '#c084fc',
  'seedream-5':      '#fb7185',
  'gpt-image-2':     '#22d3ee',
  'gpt-image-2-5':   '#06b6d4',
  'qwen-image-3':    '#a3e635',
  'krea-2-large':    '#2dd4bf',
  'recraft-v4':      '#e879f9',
  'flux-2-pro':      '#f59e0b',
  'google-omni-flash': '#f87171',
  'kling-3-pro':     '#34d399',
  'seedance-2':      '#60a5fa',
  'seedance-2-5':    '#818cf8',
  'seedance-2-mini': '#38bdf8',
  'seedvr2':         '#fb923c',
  'seedvr2-seamless': '#fdba74',
  'topaz':           '#f472b6',
  'topaz-precision': '#f9a8d4',
  'topaz-generative': '#f0abfc',
};

function modelColor(model: string): string {
  if (MODEL_COLOR_MAP[model]) return MODEL_COLOR_MAP[model];
  // Hash unknown models to one of several fallback colors
  const fallbacks = ['#818cf8', '#38bdf8', '#4ade80', '#fbbf24', '#f87171'];
  let h = 0;
  for (let i = 0; i < model.length; i++) h = (h * 31 + model.charCodeAt(i)) >>> 0;
  return fallbacks[h % fallbacks.length];
}

function BarRow({ label, value, max, gradient, color, valueLabel }: { label: string; value: number; max: number; gradient?: boolean; color?: string; valueLabel?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span
        className="text-xs truncate"
        style={{ color: 'var(--color-white-muted)', minWidth: 160, maxWidth: 160 }}
        title={label}
      >
        {label}
      </span>
      <div className="flex-1 flex items-center gap-2">
        <div
          className="rounded-full overflow-hidden"
          style={{ flex: 1, height: 6, background: 'var(--color-bg-surface)', position: 'relative' }}
        >
          {gradient ? (
            // Full-width gradient clipped to fill percentage so hue is stable
            <div
              className="absolute inset-y-0 left-0 w-full rounded-full transition-all duration-500"
              style={{
                background: 'linear-gradient(to right, #fde68a, #c4b5fd)',
                clipPath: `inset(0 ${100 - pct}% 0 0)`,
              }}
            />
          ) : (
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${pct}%`, background: color }}
            />
          )}
        </div>
        <span className={`text-xs tabular-nums shrink-0 text-right ${valueLabel ? 'min-w-20' : 'w-8'}`} style={{ color: 'var(--color-white)' }}>
          {valueLabel ?? value}
        </span>
      </div>
    </div>
  );
}

function HourChart({ traffic }: { traffic: number[] }) {
  const max    = Math.max(...traffic, 1);
  const HEIGHT = 80; // px — matches h-20
  const HOURS  = Array.from({ length: 24 }, (_, i) => {
    const ampm = i < 12 ? 'am' : 'pm';
    const h    = i === 0 ? 12 : i > 12 ? i - 12 : i;
    return `${h}${ampm}`;
  });

  return (
    <div className="flex items-end gap-0.5" style={{ height: HEIGHT }}>
      {traffic.map((count, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm"
          title={`${HOURS[i]}: ${count}`}
          style={{
            height: Math.max(Math.round((count / max) * HEIGHT), 2),
            background: count > 0 ? 'var(--color-accent)' : 'var(--color-bg-surface)',
            opacity:    count > 0 ? 0.7 + (count / max) * 0.3 : 1,
          }}
        />
      ))}
    </div>
  );
}

const TZ_TABS = [
  { key: 'nyc',    label: 'New York' },
  { key: 'mexico', label: 'Mexico City' },
  { key: 'bogota', label: 'Bogotá' },
] as const;

type TzKey = typeof TZ_TABS[number]['key'];

const SPENDING_LABELS = { day: 'Day', month: 'Month', year: 'Year', all: 'All time' };
type RankingPeriod = typeof SPENDING_PERIODS[number];

function formatSpending(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2,
    maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
  }).format(value);
}

function UserSpending() {
  const [period, setPeriod] = useState<RankingPeriod>('day');
  const [selections, setSelections] = useState(() => {
    const today = new Date().toISOString().slice(0, 10);
    return { day: today, month: today.slice(0, 7), year: today.slice(0, 4) };
  });
  const [data, setData] = useState<UserSpendingData | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const selection = period === 'all' ? undefined : selections[period];
  const today = new Date().toISOString().slice(0, 10);
  let validationError = '';
  try {
    spendingWindow(period, new Date(), selection);
  } catch (error) {
    validationError = error instanceof Error ? error.message : 'Select a valid period.';
  }

  useEffect(() => {
    if (validationError) return;
    const controller = new AbortController();
    async function load() {
      try {
        const params = new URLSearchParams({ spendingPeriod: period });
        if (selection !== undefined) params.set('spendingDate', selection);
        const response = await fetch(`/api/admin/usage?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Failed to load spending data');
        const result: UserSpendingData = await response.json();
        if (!controller.signal.aborted) setData(result);
      } catch {
        if (!controller.signal.aborted) setError('Failed to load spending data');
      }
    }
    load();
    return () => controller.abort();
  }, [period, selection, validationError, retry]);

  function selectPeriod(next: RankingPeriod) {
    if (next === period) return;
    setData(null);
    setError('');
    setPeriod(next);
  }

  const periodIndex = SPENDING_PERIODS.indexOf(period);
  const dateLabel = data?.start
    ? new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC', year: 'numeric', ...(period !== 'year' ? { month: 'short' as const } : {}),
      ...(period === 'day' ? { day: 'numeric' as const } : {}),
    }).format(new Date(data.start))
    : null;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-white)' }}>User Spending</h2>
          <p className="text-xs mt-1" style={{ color: 'var(--color-white-muted)' }}>
            {period === 'all' ? 'All retained history' : dateLabel ?? SPENDING_LABELS[period]} · UTC · Highest spend first
          </p>
        </div>
        <div className="w-64 max-w-full px-2.5 py-2 rounded-lg" style={{ background: 'var(--color-bg-surface)' }}>
          <input
            type="range"
            min={0}
            max={SPENDING_PERIODS.length - 1}
            step={1}
            value={periodIndex}
            onChange={event => selectPeriod(SPENDING_PERIODS[Number(event.target.value)])}
            aria-label="Spending period"
            aria-valuetext={SPENDING_LABELS[period]}
            aria-controls="user-spending-results"
            className="block w-full h-4 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4"
            style={{ accentColor: 'var(--color-accent)', outlineColor: 'var(--color-accent)' }}
          />
          <div className="flex justify-between mt-1">
            {SPENDING_PERIODS.map(option => (
              <button
                key={option}
                onClick={() => selectPeriod(option)}
                aria-pressed={period === option}
                className="px-1.5 py-0.5 rounded-md text-xs font-medium transition-colors"
                style={{
                  background: period === option ? 'var(--color-bg-elevated)' : 'transparent',
                  color: period === option ? 'var(--color-white)' : 'var(--color-white-muted)',
                  cursor: 'pointer',
                }}
              >
                {SPENDING_LABELS[option]}
              </button>
            ))}
          </div>
          {period !== 'all' && (
            <label className="flex items-center gap-2 mt-2 text-xs" style={{ color: 'var(--color-white-muted)' }}>
              <span>{period === 'day' ? 'Date' : SPENDING_LABELS[period]}</span>
              <input
                type={period === 'day' ? 'date' : period === 'month' ? 'month' : 'number'}
                value={selection}
                min={period === 'day' ? '0001-01-01' : period === 'month' ? '0001-01' : 1}
                max={period === 'day' ? today : period === 'month' ? today.slice(0, 7) : Number(today.slice(0, 4))}
                step={1}
                aria-label={period === 'day' ? 'Spending date' : `Spending ${period}`}
                aria-invalid={Boolean(validationError)}
                aria-describedby={validationError ? 'spending-date-error' : undefined}
                onChange={event => {
                  setData(null);
                  setError('');
                  setSelections(previous => ({ ...previous, [period]: event.target.value }));
                }}
                className={`${styles.datePicker} min-w-0 flex-1 rounded-md px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-2`}
                style={{ background: 'var(--color-bg-elevated)', color: 'var(--color-white)', border: 'var(--border-default)', outlineColor: 'var(--color-accent)' }}
              />
            </label>
          )}
        </div>
      </div>
      <div id="user-spending-results" aria-live="polite" aria-busy={!data && !error && !validationError}>
        {validationError ? (
          <p id="spending-date-error" className="text-xs" style={{ color: 'var(--color-white-muted)' }}>{validationError}</p>
        ) : error ? (
          <div className="flex items-center gap-3 text-xs">
            <p role="alert" style={{ color: 'var(--color-error)' }}>{error}</p>
            <button
              onClick={() => { setError(''); setRetry(value => value + 1); }}
              className="px-2.5 py-1 rounded-md font-medium"
              style={{ background: 'var(--color-bg-surface)', color: 'var(--color-white)', cursor: 'pointer' }}
            >Retry</button>
          </div>
        ) : !data ? (
          <div className="flex items-center gap-2 py-4 text-xs" style={{ color: 'var(--color-white-muted)' }}>
            <RefreshCw size={14} className="animate-spin" /> Loading spending data…
          </div>
        ) : (
          <>
            <div className="mb-4">
              <p className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--color-white-muted)' }}>Recorded spend · USD</p>
              <p className="text-3xl font-semibold tabular-nums" style={{ color: 'var(--color-white)' }}>{formatSpending(data.totalCostUsd)}</p>
            </div>
            {data.users.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>No recorded spending for this period</p>
            ) : (
              <div className="max-h-80 overflow-auto">
                {data.users.map((user, index) => (
                  <BarRow key={user.userId} label={`${index + 1}. ${user.username}`} value={user.costUsd}
                    max={data.users[0].costUsd} valueLabel={formatSpending(user.costUsd)} gradient />
                ))}
              </div>
            )}
            <p className="text-xs mt-4" style={{ color: 'var(--color-white-muted)' }}>
              Recorded generation costs + realtime usage.
              {data.unpricedGenerations > 0 && ` ${data.unpricedGenerations.toLocaleString()} completed generation${data.unpricedGenerations === 1 ? '' : 's'} without recorded costs excluded.`}
              {' '}History includes retained records only; deleted generations are excluded.
            </p>
          </>
        )}
      </div>
      <SpendingCalendar />
    </>
  );
}

export default function AdminUsagePage() {
  const [data, setData]       = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [tzTab, setTzTab]     = useState<TzKey>('nyc');

  useEffect(() => {
    async function load() {
      const res = await fetch('/api/admin/usage');
      if (res.ok) {
        setData(await res.json());
      } else {
        setError('Failed to load usage data');
      }
      setLoading(false);
    }
    load();
  }, []);

  const cardStyle: React.CSSProperties = {
    background: 'var(--color-bg-elevated)',
    border: 'var(--border-default)',
    borderRadius: 12,
    padding: 20,
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center gap-2" style={{ color: 'var(--color-white-muted)' }}>
        <RefreshCw size={18} className="animate-spin" />
        <span className="text-sm">Loading usage data…</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm" style={{ color: 'var(--color-error)' }}>{error || 'No data'}</p>
      </div>
    );
  }

  const maxModelCount = Math.max(...data.modelUsage.map((m) => m.count), 1);
  const maxUserCount  = Math.max(...data.userUsage.map((u) => u.count), 1);
  const maxNodeCount  = Math.max(...(data.nodeUsage ?? []).map((n) => n.count), 1);

  return (
    <div className="h-full overflow-auto p-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <BarChart2 size={24} style={{ color: 'var(--color-accent)' }} />
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-white)' }}>All Usage</h1>
          <p className="text-sm" style={{ color: 'var(--color-white-muted)' }}>
            Platform-wide generation activity across all users
          </p>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div style={cardStyle}>
          <p className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--color-white-muted)' }}>
            Total Generations
          </p>
          <p className="text-3xl font-semibold tabular-nums" style={{ color: 'var(--color-white)' }}>
            {data.totalGenerations.toLocaleString()}
          </p>
        </div>
        <div style={cardStyle}>
          <p className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--color-white-muted)' }}>
            Images Generated
          </p>
          <div className="flex items-center gap-2">
            <Image size={18} style={{ color: 'var(--color-accent)' }} />
            <p className="text-3xl font-semibold tabular-nums" style={{ color: 'var(--color-white)' }}>
              {data.mediaTypeSplit.image.toLocaleString()}
            </p>
          </div>
        </div>
        <div style={cardStyle}>
          <p className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--color-white-muted)' }}>
            Videos Generated
          </p>
          <div className="flex items-center gap-2">
            <Film size={18} style={{ color: 'var(--color-success)' }} />
            <p className="text-3xl font-semibold tabular-nums" style={{ color: 'var(--color-white)' }}>
              {data.mediaTypeSplit.video.toLocaleString()}
            </p>
          </div>
        </div>
      </div>

      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <UserSpending />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* Model usage */}
        <div style={cardStyle}>
          <p className="text-sm font-semibold mb-4" style={{ color: 'var(--color-white)' }}>Model Usage</p>
          {data.modelUsage.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>No data yet</p>
          ) : (
            <div>
              {data.modelUsage.slice(0, 12).map((m) => (
                <BarRow
                  key={m.model}
                  label={m.model}
                  value={m.count}
                  max={maxModelCount}
                  color={modelColor(m.model)}
                />
              ))}
            </div>
          )}
        </div>

        {/* User activity */}
        <div style={cardStyle}>
          <p className="text-sm font-semibold mb-4" style={{ color: 'var(--color-white)' }}>User Activity</p>
          {data.userUsage.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>No data yet</p>
          ) : (
            <div>
              {data.userUsage.slice(0, 12).map((u) => (
                <BarRow
                  key={u.userId}
                  label={u.username}
                  value={u.count}
                  max={maxUserCount}
                  gradient
                />
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Node usage */}
      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <p className="text-sm font-semibold mb-4" style={{ color: 'var(--color-white)' }}>Node Usage</p>
        {(data.nodeUsage ?? []).length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>No data yet</p>
        ) : (
          <div className="grid grid-cols-2 gap-x-8">
            {(data.nodeUsage ?? []).map((n) => (
              <BarRow
                key={n.nodeType}
                label={NODE_LABELS[n.nodeType] ?? n.nodeType}
                value={n.count}
                max={maxNodeCount}
                color={NODE_COLORS[n.nodeType] ?? '#818cf8'}
              />
            ))}
          </div>
        )}
      </div>

      {/* Hourly traffic */}
      <div style={cardStyle}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold" style={{ color: 'var(--color-white)' }}>API Traffic by Hour of Day</p>
          <div className="flex gap-1 p-0.5 rounded-lg" style={{ background: 'var(--color-bg-surface)' }}>
            {TZ_TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTzTab(key)}
                className="px-2.5 py-1 rounded-md text-xs font-medium transition-colors"
                style={{
                  background: tzTab === key ? 'var(--color-bg-elevated)' : 'transparent',
                  color:      tzTab === key ? 'var(--color-white)' : 'var(--color-white-muted)',
                  border:     'none',
                  cursor:     'pointer',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <HourChart traffic={data.hourlyTraffic[tzTab]} />
        <div className="flex justify-between mt-2" style={{ color: 'var(--color-white-muted)', fontSize: 10 }}>
          <span>12am</span>
          <span>6am</span>
          <span>12pm</span>
          <span>6pm</span>
          <span>11pm</span>
        </div>
      </div>
    </div>
  );
}
