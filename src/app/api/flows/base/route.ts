import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

// GET /api/flows/base — returns all is_template=true flows (visible to all users)
export async function GET() {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('flows')
      .select('id, title, description, thumbnail_url, created_at, updated_at, user_id')
      .eq('is_template', true)
      .order('created_at', { ascending: true });

    if (error) return NextResponse.json({ baseFlows: [] });

    const rows = data ?? [];

    // Resolve creator usernames in a single lookup.
    const userIds = [...new Set(rows.map((f) => f.user_id).filter(Boolean))];
    const usernameById = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, username')
        .in('id', userIds);
      for (const p of profiles ?? []) usernameById.set(p.id, p.username);
    }

    const baseFlows = rows.map(({ user_id, ...rest }) => ({
      ...rest,
      author_username: usernameById.get(user_id) ?? null,
    }));

    return NextResponse.json({ baseFlows });
  } catch {
    return NextResponse.json({ baseFlows: [] });
  }
}
