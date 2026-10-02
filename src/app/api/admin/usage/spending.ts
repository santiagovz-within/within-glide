import type { SupabaseClient } from '@supabase/supabase-js';
import { generationCost, recordedCost, spendingWindow, type SpendingPeriod, type UserSpendingData } from '@/lib/adminSpending';

export async function getUserSpending(supabase: SupabaseClient, period: SpendingPeriod, selection?: string): Promise<UserSpendingData> {
  const { start, end } = spendingWindow(period, new Date(), selection);
  const costs = new Map<string, number>();
  let unpricedGenerations = 0;
  const addCost = (userId: string, cost: number) => costs.set(userId, (costs.get(userId) ?? 0) + cost);
  const batch = 1000;

  // Billing columns are optional on older deployments; parameters hold the
  // same recorded charge as a fallback. Never count both representations.
  let hasBillingColumn = true;
  for (let from = 0; ; ) {
    let query = supabase.from('generations')
      .select(hasBillingColumn
        ? 'id, user_id, fal_cost_usd, billing:parameters->falBilling'
        : 'id, user_id, billing:parameters->falBilling')
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
    const rows = data as unknown as { user_id: string; fal_cost_usd?: unknown; billing?: unknown }[];
    for (const row of rows) {
      const cost = generationCost(row);
      if (cost === null) unpricedGenerations++;
      else addCost(row.user_id, cost);
    }
    // Advance by actual rows returned to respect lower PostgREST row limits.
    if (rows.length === 0) break;
    from += rows.length;
  }

  for (let from = 0; ; ) {
    let query = supabase.from('realtime_usage')
      .select('user_id, cost_usd')
      .lte('usage_date', new Date(Date.parse(end) - 1).toISOString().slice(0, 10))
      .order('usage_date', { ascending: true })
      .order('user_id', { ascending: true })
      .range(from, from + batch - 1);
    if (start) query = query.gte('usage_date', start.slice(0, 10));
    const { data, error } = await query;
    if (error) throw error;
    for (const row of data) {
      const cost = recordedCost(row.cost_usd);
      if (cost !== null) addCost(row.user_id, cost);
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

  return { period, start, end, users, unpricedGenerations, totalCostUsd: users.reduce((sum, user) => sum + user.costUsd, 0) };
}
