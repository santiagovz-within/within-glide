'use client';

import { useEffect, useState } from 'react';
import { Activity, Film, Image as ImageIcon, RefreshCw, UserCheck } from 'lucide-react';
import type { AdminUserStats } from '@/lib/adminUserStats';

const average = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const count = new Intl.NumberFormat('en-US');

export function UserStatsCards({ revision }: { revision: number }) {
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    revision: number;
    retry: number;
    data?: AdminUserStats;
    error?: string;
  } | null>(null);
  const loading = result?.revision !== revision || result?.retry !== retry;
  const stats = loading ? undefined : result?.data;
  const error = loading ? undefined : result?.error;

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch('/api/admin/users/stats', { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Unable to load user statistics.');
        const data: AdminUserStats = await response.json();
        if (!controller.signal.aborted) setResult({ revision, retry, data });
      } catch {
        if (!controller.signal.aborted) setResult({ revision, retry, error: 'Unable to load user statistics.' });
      }
    }
    void load();
    return () => controller.abort();
  }, [revision, retry]);

  const valueStyle = { color: 'var(--color-white)', fontVariantNumeric: 'tabular-nums' as const };
  const cardStyle = { background: 'var(--color-bg-elevated)', border: 'var(--border-default)' };
  const mutedStyle = { color: 'var(--color-white-muted)' };
  const period = stats
    ? `${stats.start.slice(0, 10)} through ${new Date(Date.parse(stats.end) - 1).toISOString().slice(0, 10)} · UTC · Includes days with no activity`
    : 'Last 30 complete UTC days, including days with no activity';
  const pendingValue = loading ? '…' : '—';

  return (
    <section aria-label="User statistics" aria-busy={loading} className="mb-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <article className="rounded-xl p-5 min-w-0" style={cardStyle}>
          <div className="flex items-center gap-2 text-sm font-medium" style={mutedStyle}>
            <UserCheck size={16} style={{ color: 'var(--color-success)' }} /> Active users
          </div>
          <p className="text-3xl font-semibold mt-4 mb-2" style={valueStyle}>
            {stats ? count.format(stats.approvedUsers) : pendingValue}
          </p>
          <p className="text-xs" style={mutedStyle}>Users with approved access</p>
        </article>
        <article className="rounded-xl p-5 min-w-0" style={cardStyle} title={period}>
          <div className="flex items-center gap-2 text-sm font-medium" style={mutedStyle}>
            <Activity size={16} style={{ color: 'var(--color-accent)' }} /> Average daily active users
          </div>
          <p className="text-3xl font-semibold mt-4 mb-2" style={valueStyle}>
            {stats ? average.format(stats.averageDailyActiveUsers) : pendingValue}
          </p>
          <p className="text-xs leading-relaxed" style={mutedStyle}>Unique users requesting images or videos<br />Last 30 complete days · UTC</p>
        </article>
        <article className="rounded-xl p-5 min-w-0" style={cardStyle} title={period}>
          <p className="text-sm font-medium" style={mutedStyle}>Average generations per day</p>
          <div className="flex gap-8 mt-4 mb-2">
            <div>
              <p className="text-3xl font-semibold" style={valueStyle}>{stats ? average.format(stats.averageDailyImages) : pendingValue}</p>
              <p className="flex items-center gap-1.5 text-xs mt-1" style={mutedStyle}><ImageIcon size={12} /> Images</p>
            </div>
            <div>
              <p className="text-3xl font-semibold" style={valueStyle}>{stats ? average.format(stats.averageDailyVideos) : pendingValue}</p>
              <p className="flex items-center gap-1.5 text-xs mt-1" style={mutedStyle}><Film size={12} /> Videos</p>
            </div>
          </div>
          <p className="text-xs leading-relaxed" style={mutedStyle}>Completed generations · Last 30 complete days · UTC</p>
        </article>
      </div>
      {error && (
        <div role="alert" className="flex items-center gap-3 text-xs mt-3" style={{ color: 'var(--color-error)' }}>
          {error}
          <button onClick={() => setRetry(value => value + 1)} className="inline-flex items-center gap-1 underline">
            <RefreshCw size={12} /> Retry statistics
          </button>
        </div>
      )}
    </section>
  );
}
