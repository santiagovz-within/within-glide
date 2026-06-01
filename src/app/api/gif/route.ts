import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSignedUploadUrl, getSignedReadUrl, gcsPathFromRef } from '@/lib/gcs';
import crypto from 'crypto';

/**
 * POST /api/gif
 * Returns a signed GCS write URL + gcsRef for persisting a locally-generated GIF.
 * The client PUTs the blob directly to the returned uploadUrl.
 */
export async function POST(_request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const fileId  = crypto.randomUUID();
    const gcsPath = `user-gifs/${user.id}/${fileId}.gif`;
    const gcsRef  = `gcs:${gcsPath}`;
    const uploadUrl = await getSignedUploadUrl(gcsPath, 'image/gif');

    return NextResponse.json({ uploadUrl, gcsRef });
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'Internal server error', details }, { status: 500 });
  }
}

/**
 * GET /api/gif?ref=gcs:...
 * Returns a fresh signed read URL for an already-uploaded GIF.
 * Scoped to the authenticated user — the GCS path must be under their user-gifs/ prefix.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const ref = request.nextUrl.searchParams.get('ref');
    if (!ref) return NextResponse.json({ error: 'Missing ref' }, { status: 400 });

    const path = gcsPathFromRef(ref);
    if (!path.startsWith(`user-gifs/${user.id}/`)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const url = await getSignedReadUrl(path);
    return NextResponse.json({ url });
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'Internal server error', details }, { status: 500 });
  }
}
