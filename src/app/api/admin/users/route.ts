import { NextRequest, NextResponse } from 'next/server';
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

// GET /api/admin/users — list all users with profiles
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = createAdminClient();

  const { data: { users }, error } = await supabase.auth.admin.listUsers();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const userIds = users.map((u) => u.id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, display_name, is_admin, created_at')
    .in('id', userIds);

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  const result = users.map((u) => ({
    id: u.id,
    email: u.email,
    last_sign_in_at: u.last_sign_in_at,
    created_at: u.created_at,
    profile: profileMap.get(u.id) ?? null,
  }));

  return NextResponse.json({ users: result });
}

// POST /api/admin/users — create a new user
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { email, password, display_name, is_admin: makeAdmin = false } = await request.json();
  if (!email?.trim() || !password?.trim()) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: { user }, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name },
  });

  if (createError) return NextResponse.json({ error: createError.message }, { status: 500 });
  if (!user) return NextResponse.json({ error: 'User creation failed' }, { status: 500 });

  // The profile row is created by a DB trigger, but that trigger runs asynchronously
  // from Supabase Auth. Use upsert so this succeeds whether the trigger has fired or not.
  const username = email.split('@')[0].replace(/[^a-z0-9_]/gi, '_').toLowerCase();
  const { error: profileError } = await supabase.from('profiles').upsert(
    {
      id: user.id,
      username,
      display_name: display_name?.trim() || null,
      theme: 'dark',
      is_admin: makeAdmin,
    },
    { onConflict: 'id' }
  );

  if (profileError) {
    // User was created but profile update failed (e.g. is_admin column missing).
    // Return 207 so the client knows to show a warning.
    return NextResponse.json(
      { user: { id: user.id, email: user.email }, warning: `Profile update failed: ${profileError.message}` },
      { status: 207 }
    );
  }

  return NextResponse.json({ user: { id: user.id, email: user.email } }, { status: 201 });
}
