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
    const nameById = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, username, display_name')
        .in('id', userIds);
      // Prefer the human-friendly display name, fall back to username.
      for (const p of profiles ?? []) nameById.set(p.id, p.display_name || p.username);
    }

    const baseFlows = rows.map(({ user_id, ...rest }) => ({
      ...rest,
      author_username: nameById.get(user_id) ?? null,
    }));

    return NextResponse.json({ baseFlows });
  } catch {
    return NextResponse.json({ baseFlows: [] });
  }
}
