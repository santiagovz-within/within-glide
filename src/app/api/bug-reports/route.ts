import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

async function getSessionUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

async function getAdminFlag(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.from('profiles').select('is_admin').eq('id', userId).single();
  return data?.is_admin ?? false;
}

// GET /api/bug-reports — own reports for users, all reports for admins
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const isAdmin = await getAdminFlag(user.id);
  const supabase = createAdminClient();

  let query = supabase
    .from('bug_reports')
    .select('*')
    .order('created_at', { ascending: false });

  if (!isAdmin) query = query.eq('user_id', user.id);

  const { data: reports, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const reportList = reports ?? [];

  // Enrich with author usernames
  const userIds = [...new Set(reportList.map((r) => r.user_id))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, display_name')
    .in('id', userIds);
  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  // Aggregate comment counts in one query
  const reportIds = reportList.map((r) => r.id);
  const { data: commentRows } = await supabase
    .from('bug_report_comments')
    .select('bug_report_id')
    .in('bug_report_id', reportIds);
  const countMap = new Map<string, number>();
  for (const c of commentRows ?? []) {
    countMap.set(c.bug_report_id, (countMap.get(c.bug_report_id) ?? 0) + 1);
  }

  const enriched = reportList.map((r) => ({
    ...r,
    author_username: profileMap.get(r.user_id)?.username ?? 'unknown',
    author_display_name: profileMap.get(r.user_id)?.display_name ?? null,
    comment_count: countMap.get(r.id) ?? 0,
  }));

  return NextResponse.json({ reports: enriched, isAdmin });
}

// POST /api/bug-reports — submit a new report
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { title, description, image_url } = await request.json();
  if (!title?.trim() || !description?.trim()) {
    return NextResponse.json({ error: 'Title and description are required' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('bug_reports')
    .insert({
      user_id: user.id,
      title: title.trim(),
      description: description.trim(),
      image_url: image_url ?? null,
      status: 'open',
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ report: data }, { status: 201 });
}
