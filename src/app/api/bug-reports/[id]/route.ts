import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

// GET /api/bug-reports/[id] — report detail with comments
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const supabase = createAdminClient();

  const { data: report, error } = await supabase
    .from('bug_reports')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !report) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: profile } = await userClient.from('profiles').select('is_admin').eq('id', user.id).single();
  const isAdmin = profile?.is_admin ?? false;

  if (!isAdmin && report.user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: comments } = await supabase
    .from('bug_report_comments')
    .select('*')
    .eq('bug_report_id', id)
    .order('created_at', { ascending: true });

  // Collect all unique user IDs for profile enrichment
  const userIds = [...new Set([report.user_id, ...(comments ?? []).map((c) => c.user_id)])];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, display_name')
    .in('id', userIds);
  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  const enrichedComments = (comments ?? []).map((c) => ({
    ...c,
    author_username: profileMap.get(c.user_id)?.username ?? 'unknown',
    author_display_name: profileMap.get(c.user_id)?.display_name ?? null,
  }));

  return NextResponse.json({
    report: {
      ...report,
      author_username: profileMap.get(report.user_id)?.username ?? 'unknown',
      author_display_name: profileMap.get(report.user_id)?.display_name ?? null,
      comments: enrichedComments,
    },
    isAdmin,
  });
}

// PATCH /api/bug-reports/[id] — mark resolved or reopen (admin only)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await userClient.from('profiles').select('is_admin').eq('id', user.id).single();
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const { status } = await request.json();
  if (status !== 'open' && status !== 'resolved') {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('bug_reports')
    .update({
      status,
      resolved_by: status === 'resolved' ? user.id : null,
      resolved_at: status === 'resolved' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
