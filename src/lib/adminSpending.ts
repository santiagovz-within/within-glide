export const SPENDING_PERIODS = ['day', 'month', 'year', 'all'] as const;
export type SpendingPeriod = typeof SPENDING_PERIODS[number];

export interface UserSpendingData {
  period: SpendingPeriod;
  start: string | null;
  end: string;
  totalCostUsd: number;
  unpricedGenerations: number;
  users: { userId: string; username: string; costUsd: number }[];
}

export class InvalidSpendingSelection extends Error {}

// UTC calendar intervals: include the selected start, exclude the next period.
// Cap current periods at now, while allowing any retained historical period.
export function spendingWindow(period: SpendingPeriod, now = new Date(), selection?: string) {
  if (period === 'all') return { start: null, end: now.toISOString() };
  const today = now.toISOString().slice(0, 10);
  const selected = selection ?? (period === 'day' ? today : period === 'month' ? today.slice(0, 7) : today.slice(0, 4));
  const pattern = period === 'day' ? /^\d{4}-\d{2}-\d{2}$/ : period === 'month' ? /^\d{4}-\d{2}$/ : /^\d{4}$/;
  const date = period === 'day' ? selected : period === 'month' ? `${selected}-01` : `${selected}-01-01`;
  const start = new Date(`${date}T00:00:00.000Z`);
  if (!pattern.test(selected) || Number(selected.slice(0, 4)) < 1 || !Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== date) {
    throw new InvalidSpendingSelection(`Select a valid ${period === 'day' ? 'date' : period}.`);
  }
  if (start > now) throw new InvalidSpendingSelection('Select today or an earlier period.');
  const next = new Date(start);
  if (period === 'day') next.setUTCDate(next.getUTCDate() + 1);
  else if (period === 'month') next.setUTCMonth(next.getUTCMonth() + 1);
  else next.setUTCFullYear(next.getUTCFullYear() + 1);
  return { start: start.toISOString(), end: new Date(Math.min(next.getTime(), now.getTime())).toISOString() };
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
