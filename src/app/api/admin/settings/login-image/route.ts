import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { getSignedUploadUrl } from '@/lib/gcs';

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles').select('is_admin').eq('id', user.id).single();
  return profile?.is_admin ? user : null;
}

/**
 * POST /api/admin/settings/login-image
 * Body: { contentType: string } — the exact MIME type of the file being uploaded.
 * Returns a signed GCS write URL signed for that content type, which the browser
 * must use verbatim in its PUT Content-Type header.
 */
export async function POST(request: NextRequest) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const contentType: string = body.contentType || 'image/jpeg';

  if (!contentType.startsWith('image/')) {
    return NextResponse.json({ error: 'Only image files are allowed' }, { status: 400 });
  }

  const gcsPath   = 'site/login-bg';
  const uploadUrl = await getSignedUploadUrl(gcsPath, contentType);
  const gcsRef    = `gcs:${gcsPath}`;

  return NextResponse.json({ uploadUrl, gcsRef, contentType });
}

/**
 * PATCH /api/admin/settings/login-image
 * Saves the gcsRef after the client has finished the GCS PUT.
 * Body: { gcsRef: string }
 */
export async function PATCH(request: NextRequest) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { gcsRef } = await request.json();
  if (!gcsRef) return NextResponse.json({ error: 'Missing gcsRef' }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin
    .from('site_settings')
    .upsert({ key: 'login_bg_gcs_ref', value: gcsRef, updated_at: new Date().toISOString() }, { onConflict: 'key' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

/**
 * DELETE /api/admin/settings/login-image
 * Removes the login background (reverts to plain layout).
 */
export async function DELETE(_request: NextRequest) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const admin = createAdminClient();
  await admin.from('site_settings').delete().eq('key', 'login_bg_gcs_ref');
  return NextResponse.json({ success: true });
}
