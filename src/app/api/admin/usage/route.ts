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

  // Node usage — count how many times each node type appears across all saved flows
  const { data: flows } = await supabase.from('flows').select('flow_data');
  const nodeCounts: Record<string, number> = {};
  for (const flow of flows ?? []) {
    const nodes = (flow.flow_data as { nodes?: { type?: string }[] })?.nodes ?? [];
    for (const node of nodes) {
      if (node.type) nodeCounts[node.type] = (nodeCounts[node.type] ?? 0) + 1;
    }
  }

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

  // Traffic by hour of day (0-23) — bucketed in three relevant timezones
  const TZ = {
    nyc:    'America/New_York',
    mexico: 'America/Mexico_City',
    bogota: 'America/Bogota',
  } as const;

  const hourlyTraffic: Record<string, number[]> = {
    nyc:    Array(24).fill(0),
    mexico: Array(24).fill(0),
    bogota: Array(24).fill(0),
  };

  for (const g of rows) {
    const date = new Date(g.created_at);
    for (const [key, tz] of Object.entries(TZ)) {
      const hour = parseInt(
        new Intl.DateTimeFormat('en-US', { hour: '2-digit', hourCycle: 'h23', timeZone: tz }).format(date),
        10,
      );
      hourlyTraffic[key][hour]++;
    }
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
    hourlyTraffic,
    mediaTypeSplit: { image: imageCnt, video: videoCnt },
    nodeUsage: Object.entries(nodeCounts)
      .map(([nodeType, count]) => ({ nodeType, count }))
      .sort((a, b) => b.count - a.count),
  });
}
