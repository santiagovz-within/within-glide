import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();
  return profile?.is_admin ? user : null;
}

// GET /api/admin/usage — aggregate generation stats for admins
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = createAdminClient();

  // Fetch all generations (limit to last 10k for perf)
  const { data: generations, error } = await supabase
    .from('generations')
    .select('id, user_id, model, created_at, status, media_type')
    .order('created_at', { ascending: false })
    .limit(10000);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = generations ?? [];

  // Model usage
  const modelCounts: Record<string, number> = {};
  for (const g of rows) {
    modelCounts[g.model] = (modelCounts[g.model] ?? 0) + 1;
  }

  // User usage
  const userCounts: Record<string, number> = {};
  for (const g of rows) {
    userCounts[g.user_id] = (userCounts[g.user_id] ?? 0) + 1;
  }

  // Enrich user counts with profile display names
  const userIds = Object.keys(userCounts);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, display_name')
    .in('id', userIds);

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
  const userUsage = userIds.map((uid) => ({
    userId: uid,
    count: userCounts[uid],
    username: profileMap.get(uid)?.display_name ?? profileMap.get(uid)?.username ?? uid.slice(0, 8),
  })).sort((a, b) => b.count - a.count);

  // Traffic by hour of day (0-23)
  const hourCounts: number[] = Array(24).fill(0);
  for (const g of rows) {
    const hour = new Date(g.created_at).getHours();
    hourCounts[hour]++;
  }

  // Media type split
  const imageCnt = rows.filter((g) => g.media_type === 'image').length;
  const videoCnt = rows.filter((g) => g.media_type === 'video').length;

  return NextResponse.json({
    totalGenerations: rows.length,
    modelUsage: Object.entries(modelCounts)
      .map(([model, count]) => ({ model, count }))
      .sort((a, b) => b.count - a.count),
    userUsage,
    hourlyTraffic: hourCounts,
    mediaTypeSplit: { image: imageCnt, video: videoCnt },
  });
}
