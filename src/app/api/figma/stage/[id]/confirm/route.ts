import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

/**
 * POST /api/figma/stage/[id]/confirm
 *
 * Called by the node after a successful GCS PUT.
 * Transitions the transfer from 'uploading' → 'pending', making it visible
 * to the Figma plugin's polling endpoint.
 *
 * Scoped to the authenticated user — a user cannot confirm another's transfer.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = createAdminClient();

    // Only allow confirming a transfer that:
    // 1. belongs to this user
    // 2. is still in 'uploading' status (idempotent: ignore if already 'pending')
    // 3. has not yet expired
    const { data: transfer, error: fetchError } = await admin
      .from('figma_transfers')
      .select('id, status')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !transfer) {
      return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
    }

    if (transfer.status === 'consumed') {
      return NextResponse.json({ error: 'Transfer already consumed' }, { status: 409 });
    }

    if (transfer.status === 'pending') {
      // Already confirmed (double-submit guard).
      return NextResponse.json({ success: true });
    }

    const { error: updateError } = await admin
      .from('figma_transfers')
      .update({ status: 'pending' })
      .eq('id', id)
      .eq('user_id', user.id);

    if (updateError) {
      console.error('[figma/stage/confirm POST] update error:', updateError.message);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    console.error('[figma/stage/confirm POST] Unexpected error:', details);
    return NextResponse.json({ error: 'Internal server error', details }, { status: 500 });
  }
}
