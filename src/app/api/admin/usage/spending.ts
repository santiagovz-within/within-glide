import type { SupabaseClient } from '@supabase/supabase-js';
import { generationCost, recordedCost, spendingWindow, type SpendingDay, type SpendingPeriod, type UserSpendingData } from '@/lib/adminSpending';

export async function getUserSpending(supabase: SupabaseClient, period: SpendingPeriod, selection?: string): Promise<UserSpendingData> {
  const asOf = new Date();
  const { start, end } = spendingWindow(period, asOf, selection);
  const costs = new Map<string, number>();
  const days = new Map<string, SpendingDay>();
  const getDay = (date: string) => {
    if (!days.has(date)) days.set(date, { date, costUsd: 0, unpricedGenerations: 0 });
    return days.get(date)!;
  };
  let unpricedGenerations = 0;
  const addCost = (userId: string, cost: number, date: string) => {
    costs.set(userId, (costs.get(userId) ?? 0) + cost);
    getDay(date).costUsd += cost;
  };
  const batch = 1000;

  // Billing columns are optional on older deployments; parameters hold the
  // same recorded charge as a fallback. Never count both representations.
  let hasBillingColumn = true;
  for (let from = 0; ; ) {
    let query = supabase.from('generations')
      .select(hasBillingColumn
        ? 'id, user_id, created_at, fal_cost_usd, billing:parameters->falBilling'
        : 'id, user_id, created_at, billing:parameters->falBilling')
      .eq('status', 'completed')
      .lt('created_at', end)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + batch - 1);
    if (start) query = query.gte('created_at', start);
    const { data, error } = await query;
    if (error) {
      if (hasBillingColumn && ['42703', 'PGRST204'].includes(error.code) && error.message.includes('fal_cost_usd')) {
        hasBillingColumn = false;
        continue;
      }
      throw error;
    }
    const rows = data as unknown as { user_id: string; created_at: string; fal_cost_usd?: unknown; billing?: unknown }[];
    for (const row of rows) {
      const cost = generationCost(row);
      const date = new Date(row.created_at).toISOString().slice(0, 10);
      if (cost === null) {
        unpricedGenerations++;
        getDay(date).unpricedGenerations++;
      } else addCost(row.user_id, cost, date);
    }
    // Advance by actual rows returned to respect lower PostgREST row limits.
    if (rows.length === 0) break;
    from += rows.length;
  }

  for (let from = 0; ; ) {
    let query = supabase.from('realtime_usage')
      .select('user_id, usage_date, cost_usd')
      .lte('usage_date', new Date(Date.parse(end) - 1).toISOString().slice(0, 10))
      .order('usage_date', { ascending: true })
      .order('user_id', { ascending: true })
      .range(from, from + batch - 1);
    if (start) query = query.gte('usage_date', start.slice(0, 10));
    const { data, error } = await query;
    if (error) throw error;
    for (const row of data) {
      const cost = recordedCost(row.cost_usd);
      if (cost !== null) addCost(row.user_id, cost, row.usage_date);
    }
    if (data.length === 0) break;
    from += data.length;
  }

  const userIds = [...costs.keys()];
  const names = new Map<string, string>();
  // Keep profile lookups below URL/row limits as the user base grows.
  for (let from = 0; from < userIds.length; from += 100) {
    const { data, error } = await supabase.from('profiles')
      .select('id, username, display_name')
      .in('id', userIds.slice(from, from + 100));
    if (error) throw error;
    for (const profile of data) names.set(profile.id, profile.display_name || profile.username);
  }

  const users = userIds.map(userId => ({
    userId,
    username: names.get(userId) || userId.slice(0, 8),
    costUsd: costs.get(userId)!,
  })).filter(user => user.costUsd > 0)
    .sort((a, b) => b.costUsd - a.costUsd || a.username.localeCompare(b.username) || a.userId.localeCompare(b.userId));

  return { period, start, end, asOf: asOf.toISOString(),
    dailySpend: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    users, unpricedGenerations, totalCostUsd: users.reduce((sum, user) => sum + user.costUsd, 0) };
}
