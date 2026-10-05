'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { buildSpendingCalendar, spendingWindow, type UserSpendingData } from '@/lib/adminSpending';
import styles from './usage.module.css';

type CalendarView = 'month' | 'week';
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const money = (value: number) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2,
  maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
}).format(value);
const dateLabel = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

function shiftPeriod(view: CalendarView, anchor: string, direction: number) {
  const date = new Date(`${anchor}T00:00:00Z`);
  if (view === 'month') {
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + direction);
  } else {
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7 + direction * 7);
  }
  return date.toISOString().slice(0, 10);
}

function spendingLevel(cost: number) {
  return cost >= 100 ? styles.highSpend : cost >= 50 ? styles.mediumSpend : cost > 0 ? styles.lowSpend : '';
}

export default function SpendingCalendar() {
  const [view, setView] = useState<CalendarView>('month');
  const [anchor, setAnchor] = useState(() => new Date().toISOString().slice(0, 10));
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: UserSpendingData; error?: string } | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const selection = view === 'month' ? anchor.slice(0, 7) : anchor;
  const key = `${view}:${selection}`;
  let validationError = '';
  try {
    spendingWindow(view, new Date(), selection);
  } catch (error) {
    validationError = error instanceof Error ? error.message : 'Select a valid period.';
  }

  useEffect(() => {
    if (validationError) return;
    const controller = new AbortController();
    async function load() {
      try {
        const params = new URLSearchParams({ spendingPeriod: view, spendingDate: selection });
        const response = await fetch(`/api/admin/usage?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Failed to load daily spending');
        const data: UserSpendingData = await response.json();
        if (!controller.signal.aborted) setResult({ key, data });
      } catch {
        if (!controller.signal.aborted) setResult({ key, error: 'Failed to load daily spending' });
      }
    }
    load();
    return () => controller.abort();
  }, [view, selection, key, validationError, retry]);

  const data = result?.key === key ? result.data : undefined;
  const error = result?.key === key ? result.error : undefined;
  const calendar = data && !validationError ? buildSpendingCalendar(view, selection, data.dailySpend, data.asOf) : null;
  const next = validationError ? null : shiftPeriod(view, anchor, 1);
  const previous = validationError ? null : shiftPeriod(view, anchor, -1);
  const title = calendar
    ? view === 'month'
      ? dateLabel(calendar.days[0].date, { month: 'long', year: 'numeric' })
      : `${dateLabel(calendar.days[0].date, { month: 'short', day: 'numeric', year: 'numeric' })} – ${dateLabel(calendar.days[6].date, { month: 'short', day: 'numeric', year: 'numeric' })}`
    : 'Daily Spending';
  const slots = calendar ? [
    ...Array<null>(calendar.leadingDays).fill(null), ...calendar.days,
    ...Array<null>((7 - (calendar.leadingDays + calendar.days.length) % 7) % 7).fill(null),
  ] : [];
  const weeks = Array.from({ length: slots.length / 7 }, (_, index) => slots.slice(index * 7, index * 7 + 7));

  return (
    <section className="mt-6 pt-5" style={{ borderTop: 'var(--border-default)' }} aria-labelledby="daily-spending-heading">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <h3 id="daily-spending-heading" className="text-sm font-semibold" style={{ color: 'var(--color-white)' }}>Daily Spending</h3>
          <p className="text-xs mt-1" style={{ color: 'var(--color-white-muted)' }}>All users · Recorded spend in USD · UTC</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 p-0.5 rounded-lg" style={{ background: 'var(--color-bg-surface)' }} aria-label="Calendar view">
            {(['month', 'week'] as const).map(option => (
              <button key={option} type="button" aria-pressed={view === option} onClick={() => setView(option)}
                className="px-2.5 py-1 rounded-md text-xs font-medium transition-colors"
                style={{ background: view === option ? 'var(--color-bg-elevated)' : 'transparent', color: view === option ? 'var(--color-white)' : 'var(--color-white-muted)', cursor: 'pointer' }}>
                {option === 'month' ? 'Month' : 'Week'}
              </button>
            ))}
          </div>
          <button type="button" aria-label={`Previous ${view}`} disabled={!previous || previous < '0001-01-01'}
            onClick={() => previous && setAnchor(previous)} className={styles.calendarNav}><ChevronLeft size={15} /></button>
          <input aria-label={view === 'month' ? 'Calendar month' : 'Week containing'} type={view === 'month' ? 'month' : 'date'}
            value={selection} min={view === 'month' ? '0001-01' : '0001-01-01'} max={view === 'month' ? today.slice(0, 7) : today}
            aria-invalid={Boolean(validationError)} aria-describedby={validationError ? 'calendar-date-error' : undefined}
            onChange={event => setAnchor(event.target.value ? `${event.target.value}${view === 'month' ? '-01' : ''}` : '')}
            className={`${styles.datePicker} rounded-md px-2 py-1 text-xs min-w-0`}
            style={{ background: 'var(--color-bg-surface)', color: 'var(--color-white)', border: 'var(--border-default)' }} />
          <button type="button" aria-label={`Next ${view}`} disabled={!next || next > today}
            onClick={() => next && setAnchor(next)} className={styles.calendarNav}><ChevronRight size={15} /></button>
        </div>
      </div>
      <div aria-live="polite" aria-busy={!calendar && !error && !validationError}>
        {validationError ? <p id="calendar-date-error" className="text-xs" style={{ color: 'var(--color-white-muted)' }}>{validationError}</p>
          : error ? <div className="flex items-center gap-3 text-xs">
            <p role="alert" style={{ color: 'var(--color-error)' }}>{error}</p>
            <button type="button" className="underline" onClick={() => { setResult(null); setRetry(value => value + 1); }}>Retry calendar</button>
          </div>
          : !calendar ? <div className="flex items-center gap-2 py-8 text-xs" style={{ color: 'var(--color-white-muted)' }}>
            <RefreshCw size={14} className="animate-spin" /> Loading daily spending…
          </div>
          : <>
            <h4 className="text-base font-semibold mb-3" style={{ color: 'var(--color-white)' }}>{title}</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              {[
                { label: `${view === 'month' ? 'Month' : 'Week'} total`, value: money(calendar.totalCostUsd), detail: calendar.days.some(day => day.today) ? 'So far · today is partial' : 'Recorded spend' },
                { label: 'Daily average', value: money(calendar.averageCostUsd), detail: `${calendar.elapsedDays} calendar days · includes $0 days` },
                { label: 'Highest day', value: calendar.peak ? money(calendar.peak.costUsd) : '—', detail: calendar.peak ? dateLabel(calendar.peak.date, { month: 'short', day: 'numeric' }) : 'No recorded spending' },
              ].map(metric => <div key={metric.label} className="rounded-lg px-3 py-2.5" style={{ background: 'var(--color-bg-surface)' }}>
                <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--color-white-muted)' }}>{metric.label}</p>
                <p className="text-2xl font-semibold tabular-nums my-0.5" style={{ color: 'var(--color-white)' }}>{metric.value}</p>
                <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>{metric.detail}</p>
              </div>)}
            </div>
            <div className="overflow-x-auto">
              <table className={styles.calendar} aria-label={`${title} daily spending`}>
                <thead><tr>{[...WEEKDAYS, 'Week total'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
                <tbody>{weeks.map((week, index) => {
                  const elapsed = week.filter(day => day && !day.future);
                  const weekTotal = elapsed.reduce((sum, day) => sum + day!.costUsd, 0);
                  return <tr key={index}>
                    {week.map((day, dayIndex) => <td key={day?.date ?? `empty-${dayIndex}`}>
                      {day && <div data-date={day.date} className={`${styles.calendarDay} ${day.future ? styles.futureDay : spendingLevel(day.costUsd)}`}
                        title={`${dateLabel(day.date, { dateStyle: 'full' })}: ${day.future ? 'Future date' : `${money(day.costUsd)} recorded${day.today ? ' so far' : ''}${day.unpricedGenerations ? `; ${day.unpricedGenerations} generations without costs` : ''}`}`}>
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs" style={{ color: 'var(--color-white-muted)' }}>{Number(day.date.slice(-2))}</span>
                          {day.today && <span className={styles.todayLabel}>Today</span>}
                          {day.unpricedGenerations > 0 && <span className="text-xs" style={{ color: 'var(--color-warning)' }} aria-label={`${day.unpricedGenerations} generations without costs`}>*</span>}
                        </div>
                        <p className="text-sm font-semibold tabular-nums mt-2" style={{ color: day.future ? 'var(--color-white-muted)' : 'var(--color-white)' }}>{day.future ? '—' : money(day.costUsd)}</p>
                      </div>}
                    </td>)}
                    <td><div className={`${styles.calendarDay} ${styles.weekTotal}`}>
                      <span className="text-xs" style={{ color: 'var(--color-white-muted)' }}>{view === 'month' ? 'In month' : 'Total'}</span>
                      <p className="text-sm font-semibold tabular-nums mt-2" style={{ color: 'var(--color-white)' }}>{elapsed.length ? money(weekTotal) : '—'}</p>
                    </div></td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 mt-3 text-xs" style={{ color: 'var(--color-white-muted)' }}>
              <span>Weeks run Mon–Sun{view === 'month' ? ' · Week totals include this month only' : ''}</span>
              <div className="flex items-center gap-3" aria-label="Spending color legend">
                {[[0, '$0'], [1, 'Under $50'], [50, '$50–99.99'], [100, '$100+']].map(([cost, label]) => <span key={label} className="inline-flex items-center gap-1.5">
                  <span className={`${styles.legendSwatch} ${spendingLevel(Number(cost))}`} />{label}
                </span>)}
              </div>
            </div>
            <p className="text-xs mt-2" style={{ color: 'var(--color-white-muted)' }}>
              {calendar.days.some(day => day.today) ? 'Today is partial. Future days are excluded from the average. ' : ''}
              {calendar.unpricedGenerations > 0 ? `* ${calendar.unpricedGenerations.toLocaleString()} generations without costs excluded. ` : ''}
              Retained generation costs + realtime usage; deleted records are excluded.
            </p>
          </>}
      </div>
    </section>
  );
}
