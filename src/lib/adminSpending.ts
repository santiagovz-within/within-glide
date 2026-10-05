export const SPENDING_PERIODS = ['day', 'month', 'year', 'all'] as const;
export type SpendingPeriod = typeof SPENDING_PERIODS[number] | 'week';

export function isSpendingPeriod(value: string): value is SpendingPeriod {
  return value === 'week' || SPENDING_PERIODS.some(period => period === value);
}

export interface SpendingDay {
  date: string;
  costUsd: number;
  unpricedGenerations: number;
}

export interface UserSpendingData {
  period: SpendingPeriod;
  start: string | null;
  end: string;
  asOf: string;
  dailySpend: SpendingDay[];
  totalCostUsd: number;
  unpricedGenerations: number;
  users: { userId: string; username: string; costUsd: number }[];
}

export class InvalidSpendingSelection extends Error {}

// UTC calendar intervals: include the selected start, exclude the next period.
// Cap current periods at now, while allowing any retained historical period.
export function spendingWindow(period: SpendingPeriod, now = new Date(), selection?: string) {
  if (period === 'all') return { start: null, end: now.toISOString() };
  const isDay = period === 'day' || period === 'week';
  const today = now.toISOString().slice(0, 10);
  const selected = selection ?? (isDay ? today : period === 'month' ? today.slice(0, 7) : today.slice(0, 4));
  const pattern = isDay ? /^\d{4}-\d{2}-\d{2}$/ : period === 'month' ? /^\d{4}-\d{2}$/ : /^\d{4}$/;
  const date = isDay ? selected : period === 'month' ? `${selected}-01` : `${selected}-01-01`;
  const start = new Date(`${date}T00:00:00.000Z`);
  if (!pattern.test(selected) || Number(selected.slice(0, 4)) < 1 || !Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== date) {
    throw new InvalidSpendingSelection(`Select a valid ${isDay ? 'date' : period}.`);
  }
  if (start > now) throw new InvalidSpendingSelection('Select today or an earlier period.');
  if (period === 'week') start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  const next = new Date(start);
  if (period === 'day') next.setUTCDate(next.getUTCDate() + 1);
  else if (period === 'week') next.setUTCDate(next.getUTCDate() + 7);
  else if (period === 'month') next.setUTCMonth(next.getUTCMonth() + 1);
  else next.setUTCFullYear(next.getUTCFullYear() + 1);
  return { start: start.toISOString(), end: new Date(Math.min(next.getTime(), now.getTime())).toISOString() };
}

export function buildSpendingCalendar(period: 'month' | 'week', selection: string, dailySpend: SpendingDay[], asOf: string) {
  const { start } = spendingWindow(period, new Date(asOf), selection);
  const first = new Date(start!);
  const end = new Date(first);
  if (period === 'month') end.setUTCMonth(end.getUTCMonth() + 1);
  else end.setUTCDate(end.getUTCDate() + 7);
  const today = asOf.slice(0, 10);
  const records = new Map(dailySpend.map(day => [day.date, day]));
  const days = [];
  for (const cursor = new Date(first); cursor < end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    const future = date > today;
    const record = records.get(date);
    days.push({ date, future, today: date === today,
      costUsd: future ? 0 : record?.costUsd ?? 0,
      unpricedGenerations: future ? 0 : record?.unpricedGenerations ?? 0 });
  }
  const elapsed = days.filter(day => !day.future);
  const totalCostUsd = elapsed.reduce((sum, day) => sum + day.costUsd, 0);
  const peak = elapsed.reduce<(typeof days)[number] | null>((highest, day) => !highest || day.costUsd > highest.costUsd ? day : highest, null);
  return {
    days,
    leadingDays: (first.getUTCDay() + 6) % 7,
    elapsedDays: elapsed.length,
    totalCostUsd,
    averageCostUsd: elapsed.length ? totalCostUsd / elapsed.length : 0,
    peak: peak && peak.costUsd > 0 ? peak : null,
    unpricedGenerations: elapsed.reduce((sum, day) => sum + day.unpricedGenerations, 0),
  };
}

export function recordedCost(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const cost = Number(value);
  return Number.isFinite(cost) && cost >= 0 ? cost : null;
}

export function generationCost(row: { fal_cost_usd?: unknown; billing?: unknown }): number | null {
  const direct = recordedCost(row.fal_cost_usd);
  if (direct !== null) return direct;
  const billing = row.billing;
  if (!billing || typeof billing !== 'object' || Array.isArray(billing)) return null;
  return recordedCost((billing as { costUsd?: unknown }).costUsd);
}
