import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { getAdminUserStats } from './summary';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single();
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    return NextResponse.json(await getAdminUserStats(createAdminClient()), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('[admin/users/stats] Could not load user statistics:', error);
    return NextResponse.json({ error: 'Unable to load user statistics. Please try again.' }, { status: 500 });
  }
}
