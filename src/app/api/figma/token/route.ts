import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import crypto from 'crypto';

function generateRawToken(): string {
  // 32 random bytes → base64url gives ~43 URL-safe chars
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/** GET — returns whether a token is configured and its first-8-char prefix for identification. */
export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('figma_token_prefix')
      .eq('id', user.id)
      .single();

    if (error) {
      console.error('[figma/token GET] profile fetch error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      configured: !!profile?.figma_token_prefix,
      prefix: profile?.figma_token_prefix ?? null,
    });
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    console.error('[figma/token GET] Unexpected error:', details);
    return NextResponse.json({ error: 'Internal server error', details }, { status: 500 });
  }
}

/** POST — generates (or regenerates) a token. Returns the raw token once; only the hash is persisted. */
export async function POST(_request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const raw    = generateRawToken();
    const hash   = hashToken(raw);
    const prefix = raw.substring(0, 8);

    // Use admin client so the update isn't blocked by RLS on profiles.
    const admin = createAdminClient();
    const { error } = await admin
      .from('profiles')
      .update({ figma_token_hash: hash, figma_token_prefix: prefix })
      .eq('id', user.id);

    if (error) {
      console.error('[figma/token POST] update error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // The raw token is returned once here. The caller must copy it immediately —
    // it cannot be recovered later; only the prefix is shown from this point.
    return NextResponse.json({ token: raw, prefix });
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    console.error('[figma/token POST] Unexpected error:', details);
    return NextResponse.json({ error: 'Internal server error', details }, { status: 500 });
  }
}

/** DELETE — revokes the token (clears hash + prefix). */
export async function DELETE(_request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = createAdminClient();
    const { error } = await admin
      .from('profiles')
      .update({ figma_token_hash: null, figma_token_prefix: null })
      .eq('id', user.id);

    if (error) {
      console.error('[figma/token DELETE] update error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    console.error('[figma/token DELETE] Unexpected error:', details);
    return NextResponse.json({ error: 'Internal server error', details }, { status: 500 });
  }
}
