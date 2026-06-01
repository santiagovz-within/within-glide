import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getSignedReadUrl, gcsPathFromRef } from '@/lib/gcs';

/**
 * GET /api/settings/login-image
 * Public — no auth required. Returns a fresh signed URL for the login
 * background image, or { url: null } if none has been set.
 */
export async function GET() {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from('site_settings')
      .select('value')
      .eq('key', 'login_bg_gcs_ref')
      .maybeSingle();

    if (!data?.value) {
      return NextResponse.json({ url: null });
    }

    const url = await getSignedReadUrl(gcsPathFromRef(data.value));
    return NextResponse.json({ url });
  } catch {
    return NextResponse.json({ url: null });
  }
}
