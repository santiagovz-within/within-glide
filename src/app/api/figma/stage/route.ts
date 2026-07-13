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
    const { sizeBytes, width, height, existingGcsRef, contentType: rawContentType } = body as {
      sizeBytes?: number;
      width?: number;
      height?: number;
      existingGcsRef?: string;
      contentType?: string;
    };

    const contentType = rawContentType ?? 'image/gif';
    // Derive a safe file extension from the MIME type (e.g. 'image/png' → 'png').
    const ext = contentType.split('/')[1]?.replace(/\+.*$/, '') ?? 'gif';

    if (typeof sizeBytes === 'number' && sizeBytes > MAX_GIF_BYTES) {
      return NextResponse.json(
        { error: `GIF exceeds maximum transfer size (${MAX_GIF_BYTES / 1024 / 1024} MB)` },
        { status: 413 },
      );
    }

    const admin      = createAdminClient();
    const transferId = crypto.randomUUID();
    const expiresAt  = new Date(Date.now() + TRANSFER_TTL_MS).toISOString();

    // If the GIF is already on GCS (persisted from conversion), skip the upload
    // entirely and create the transfer row as immediately 'pending'.
    if (existingGcsRef) {
      if (!existingGcsRef.startsWith(`gcs:user-gifs/${user.id}/`)) {
        return NextResponse.json({ error: 'Invalid GCS ref' }, { status: 403 });
      }
      const { error: insertError } = await admin
        .from('figma_transfers')
        .insert({
          id:         transferId,
          user_id:    user.id,
          gcs_ref:    existingGcsRef,
          width:      width  ?? null,
          height:     height ?? null,
          size_bytes: sizeBytes ?? null,
          status:     'pending',
          expires_at: expiresAt,
        });
      if (insertError) {
        console.error('[figma/stage POST] insert error:', insertError.message);
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
      return NextResponse.json({ id: transferId, expiresAt });
    }

    // New upload: generate a GCS path and a signed write URL.
    const gcsPath   = `figma-transfers/${user.id}/${transferId}.${ext}`;
    const gcsRef    = `gcs:${gcsPath}`;
    const uploadUrl = await getSignedUploadUrl(gcsPath, contentType);

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
