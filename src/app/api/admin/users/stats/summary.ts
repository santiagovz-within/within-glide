import type { SupabaseClient } from '@supabase/supabase-js';
import { userStatsWindow, type AdminUserStats } from '@/lib/adminUserStats';

export async function getAdminUserStats(supabase: SupabaseClient, now = new Date()): Promise<AdminUserStats> {
  const window = userStatsWindow(now);
  const { count, error } = await supabase.from('profiles')
    .select('id', { count: 'exact', head: true }).eq('approved', true);
  if (error) throw error;
  if (count === null) throw new Error('Approved user count is unavailable');

  const activeUsersByDay = new Map<string, Set<string>>();
  let images = 0;
  let videos = 0;
  // Page through the entire window; never silently truncate at PostgREST's row limit.
  for (let from = 0; ; ) {
    const { data, error: generationError } = await supabase.from('generations')
      .select('id, user_id, created_at, media_type, status')
      .in('media_type', ['image', 'video'])
      .gte('created_at', window.start)
      .lt('created_at', window.end)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (generationError) throw generationError;
    if (!data) throw new Error('Generation activity is unavailable');
    if (data.length === 0) break;
    for (const row of data) {
      const day = new Date(row.created_at).toISOString().slice(0, 10);
      if (row.user_id) {
        if (!activeUsersByDay.has(day)) activeUsersByDay.set(day, new Set());
        activeUsersByDay.get(day)!.add(row.user_id);
      }
      if (row.status !== 'completed') continue;
      if (row.media_type === 'image') images++;
      if (row.media_type === 'video') videos++;
    }
    from += data.length;
  }

  const activeUserDays = [...activeUsersByDay.values()].reduce((total, users) => total + users.size, 0);
  return {
    approvedUsers: count,
    averageDailyActiveUsers: activeUserDays / window.days,
    averageDailyImages: images / window.days,
    averageDailyVideos: videos / window.days,
    ...window,
  };
}
