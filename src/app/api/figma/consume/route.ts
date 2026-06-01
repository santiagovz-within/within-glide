import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import crypto from 'crypto';

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
 * POST /api/figma/consume
 *
 * Called by the Figma plugin after it has successfully placed the GIF into
 * the open Figma file via figma.createImage(bytes).
 *
 * Marks the transfer as 'consumed' so repeated plugin polls don't return it
 * again. Scoped to the token's user — a plugin cannot consume another user's
 * transfer even if the ID is known.
 *
 * Body: { id: string }
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await resolveUserFromToken(request);
    if (!userId) {
      return NextResponse.json({ error: 'Invalid or missing plugin token' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { id } = body as { id?: string };

    if (!id) {
      return NextResponse.json({ error: 'Missing transfer id' }, { status: 400 });
    }

    const admin = createAdminClient();
    const now   = new Date().toISOString();

    // Verify the transfer belongs to this user and is still pending.
    const { data: transfer, error: fetchError } = await admin
      .from('figma_transfers')
      .select('id, status')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (fetchError || !transfer) {
      return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
    }

    if (transfer.status === 'consumed') {
      // Idempotent: already consumed, acknowledge success.
      return NextResponse.json({ success: true });
    }

    const { error: updateError } = await admin
      .from('figma_transfers')
      .update({ status: 'consumed', consumed_at: now })
      .eq('id', id)
      .eq('user_id', userId);

    if (updateError) {
      console.error('[figma/consume POST] update error:', updateError.message);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    console.error('[figma/consume POST] Unexpected error:', details);
    return NextResponse.json({ error: 'Internal server error', details }, { status: 500 });
  }
}
