import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getSignedUploadUrl } from '@/lib/gcs';
import crypto from 'crypto';

const MAX_GIF_BYTES  = 30 * 1024 * 1024; // 30 MB ceiling
const TRANSFER_TTL_MS = 60 * 60 * 1000;  // 1 hour

/**
 * POST /api/figma/stage
 *
 * Called by the VideoToGifNode when the user clicks "Send to Figma".
 * Creates a transfer record (status='uploading') and returns a GCS signed
 * upload URL so the browser can PUT the GIF blob directly — bypassing the
 * Vercel 4.5 MB request-body limit.
 *
 * Body: { sizeBytes: number, width?: number, height?: number }
 * Returns: { id, uploadUrl, expiresAt }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const { sizeBytes, width, height } = body as {
      sizeBytes?: number;
      width?: number;
      height?: number;
    };

    if (typeof sizeBytes === 'number' && sizeBytes > MAX_GIF_BYTES) {
      return NextResponse.json(
        { error: `GIF exceeds maximum transfer size (${MAX_GIF_BYTES / 1024 / 1024} MB)` },
        { status: 413 },
      );
    }

    // Generate a stable UUID for both the DB row and the GCS object path.
    const transferId = crypto.randomUUID();
    const gcsPath    = `figma-transfers/${user.id}/${transferId}.gif`;
    const gcsRef     = `gcs:${gcsPath}`;
    const expiresAt  = new Date(Date.now() + TRANSFER_TTL_MS).toISOString();

    // Pre-sign the GCS upload URL (valid 15 min — sufficient for the immediate PUT).
    const uploadUrl = await getSignedUploadUrl(gcsPath, 'image/gif');

    // Insert the transfer record before the client starts uploading.
    // status='uploading' means the GCS object might not exist yet;
    // the /confirm endpoint transitions it to 'pending'.
    const admin = createAdminClient();
    const { error: insertError } = await admin
      .from('figma_transfers')
      .insert({
        id:         transferId,
        user_id:    user.id,
        gcs_ref:    gcsRef,
        width:      width  ?? null,
        height:     height ?? null,
        size_bytes: sizeBytes ?? null,
        status:     'uploading',
        expires_at: expiresAt,
      });

    if (insertError) {
      console.error('[figma/stage POST] insert error:', insertError.message);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ id: transferId, uploadUrl, expiresAt });
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    console.error('[figma/stage POST] Unexpected error:', details);
    return NextResponse.json({ error: 'Internal server error', details }, { status: 500 });
  }
}
