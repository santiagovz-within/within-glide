import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

// POST /api/bug-reports/[id]/comments — admin only
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await userClient.from('profiles').select('is_admin').eq('id', user.id).single();
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const { content } = await request.json();
  if (!content?.trim()) return NextResponse.json({ error: 'Content is required' }, { status: 400 });

  const supabase = createAdminClient();

  // Verify the report exists
  const { data: report } = await supabase.from('bug_reports').select('id').eq('id', id).single();
  if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 });

  const { data: comment, error } = await supabase
    .from('bug_report_comments')
    .insert({ bug_report_id: id, user_id: user.id, content: content.trim() })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: authorProfile } = await supabase
    .from('profiles')
    .select('username, display_name')
    .eq('id', user.id)
    .single();

  return NextResponse.json({
    comment: {
      ...comment,
      author_username: authorProfile?.username ?? 'admin',
      author_display_name: authorProfile?.display_name ?? null,
    },
  }, { status: 201 });
}
