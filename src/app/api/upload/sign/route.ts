import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
};

// POST /api/upload/sign
// Returns a one-time signed upload token so the browser can PUT the file
// directly to Supabase Storage — the file bytes never cross a Vercel function.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { contentType } = await request.json();
  const ext = ALLOWED_TYPES[contentType as string];
  if (!ext) {
    return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
  }

  const path = `${user.id}/refs/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const admin = createAdminClient();

  const { data, error } = await admin.storage
    .from('uploads')
    .createSignedUploadUrl(path);

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Failed to create upload URL' }, { status: 500 });
  }

  const { data: { publicUrl } } = admin.storage.from('uploads').getPublicUrl(path);

  return NextResponse.json({ path: data.path, token: data.token, publicUrl });
}
