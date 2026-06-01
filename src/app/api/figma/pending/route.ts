import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getSignedReadUrl, gcsPathFromRef } from '@/lib/gcs';
import crypto from 'crypto';

/**
 * Resolves the Supabase user ID from a raw plugin token sent as
 *   Authorization: Token <raw_token>
 *
 * Hashes the raw token with SHA-256 and looks it up in profiles.
 * Returns null if the header is missing, malformed, or the hash has no match.
 */
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

/**
 * GET /api/figma/pending
 *
 * Called by the Figma plugin on its polling interval.
 * Authenticates via the shared link token (Authorization: Token <raw>).
 *
 * Returns the most recent unconsumed, non-expired transfer for this user,
 * including a fresh 1-hour signed GCS read URL for the plugin to download
 * the GIF bytes. Returns { transfer: null } when the queue is empty.
 *
 * Per-user scoping is enforced by resolving the user from the token —
 * a token can only ever surface its own user's pending transfers.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = await resolveUserFromToken(request);
    if (!userId) {
      return NextResponse.json({ error: 'Invalid or missing plugin token' }, { status: 401 });
    }

    const admin = createAdminClient();
    const now   = new Date().toISOString();

    const { data, error } = await admin
      .from('figma_transfers')
      .select('id, gcs_ref, width, height, size_bytes, created_at')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .gt('expires_at', now)           // not expired
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[figma/pending GET] query error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ transfer: null });
    }

    // Generate a fresh signed URL so the plugin can download the bytes.
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
    });
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    console.error('[figma/pending GET] Unexpected error:', details);
    return NextResponse.json({ error: 'Internal server error', details }, { status: 500 });
  }
}
