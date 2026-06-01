import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

const ALLOWED_DOMAIN = 'within.co';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=no_code`);
  }

  const supabase = await createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    console.error('[auth/callback] exchange error:', exchangeError.message);
    return NextResponse.redirect(`${origin}/login?error=callback`);
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) {
    return NextResponse.redirect(`${origin}/login?error=callback`);
  }

  // ── Domain check ───────────────────────────────────────────────────────────
  if (!user.email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=domain`);
  }

  // ── Ensure profile row exists ──────────────────────────────────────────────
  // For Google OAuth the profile is not created by any existing trigger,
  // so we upsert it here. New users get approved=false until an admin approves.
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from('profiles')
    .select('id, approved')
    .eq('id', user.id)
    .maybeSingle();

  if (!existing) {
    const username = user.email.split('@')[0].replace(/[^a-z0-9_]/gi, '_').toLowerCase();
    const displayName = user.user_metadata?.full_name ?? user.user_metadata?.name ?? null;
    await admin.from('profiles').insert({
      id:           user.id,
      username,
      display_name: displayName,
      theme:        'dark',
      is_admin:     false,
      approved:     false,
    });
  }

  // ── Route based on approval ────────────────────────────────────────────────
  const approved = existing?.approved ?? false;
  if (!approved) {
    return NextResponse.redirect(`${origin}/pending`);
  }

  return NextResponse.redirect(`${origin}/dashboard`);
}
