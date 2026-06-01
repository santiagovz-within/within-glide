import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getSignedReadUrl, gcsPathFromRef } from '@/lib/gcs';
import crypto from 'crypto';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

async function resolveUserFromToken(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get('authorization') ?? '';
  const match = authHeader.match(/^Token\s+(.+)$/i);
  if (!match) return null;

  const rawToken = match[1].trim();
  const hash     = crypto.createHash('sha256').update(rawToken).digest('hex');

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('profiles')
    .select('id')
    .eq('figma_token_hash', hash)
    .maybeSingle();

  if (error || !data) return null;
  return data.id as string;
}

export async function GET(request: NextRequest) {
  try {
    const userId = await resolveUserFromToken(request);
    if (!userId) {
      return NextResponse.json({ error: 'Invalid or missing plugin token' }, { status: 401, headers: CORS_HEADERS });
    }

    const admin = createAdminClient();
    const now   = new Date().toISOString();

    const { data, error } = await admin
      .from('figma_transfers')
      .select('id, gcs_ref, width, height, size_bytes, created_at')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .gt('expires_at', now)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[figma/pending GET] query error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500, headers: CORS_HEADERS });
    }

    if (!data) {
      return NextResponse.json({ transfer: null }, { headers: CORS_HEADERS });
    }

    const downloadUrl = await getSignedReadUrl(gcsPathFromRef(data.gcs_ref));

    return NextResponse.json({
      transfer: {
        id:          data.id,
        downloadUrl,
        width:       data.width,
        height:      data.height,
        sizeBytes:   data.size_bytes,
        createdAt:   data.created_at,
      },
    }, { headers: CORS_HEADERS });
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    console.error('[figma/pending GET] Unexpected error:', details);
    return NextResponse.json({ error: 'Internal server error', details }, { status: 500, headers: CORS_HEADERS });
  }
}
