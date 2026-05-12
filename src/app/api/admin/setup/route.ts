import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

// POST /api/admin/setup
// One-time endpoint: grants admin to the earliest registered user.
// Call once from the browser after running the SQL migration.
export async function POST() {
  try {
    const supabase = createAdminClient();

    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, created_at')
      .order('created_at', { ascending: true })
      .limit(1);

    if (error || !profiles?.length) {
      return NextResponse.json({ error: 'No users found' }, { status: 404 });
    }

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ is_admin: true })
      .eq('id', profiles[0].id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, adminId: profiles[0].id });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
