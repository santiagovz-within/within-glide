import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSignedReadUrl, signGcsRef, isGcsRef } from '@/lib/gcs';

const BUCKET = process.env.GCS_BUCKET_NAME ?? 'within-glide';
const SIGNED_URL_RE = new RegExp(
  `^https://storage\\.googleapis\\.com/${BUCKET}/([^?]+)\\?`,
);

function extractPath(url: string): string | null {
  const m = url.match(SIGNED_URL_RE);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Returns true if a signed URL is expired or within 24 hours of expiry. */
function needsResigning(url: string): boolean {
  const dateMatch = url.match(/[?&]X-Goog-Date=(\d{8}T\d{6}Z)/);
  const expiresMatch = url.match(/[?&]X-Goog-Expires=(\d+)/);
  if (!dateMatch || !expiresMatch) return true; // malformed — re-sign to be safe
  const s = dateMatch[1];
  const signedAt = Date.UTC(
    +s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8),
    +s.slice(9, 11), +s.slice(11, 13), +s.slice(13, 15),
  );
  const expiryMs = signedAt + parseInt(expiresMatch[1]) * 1000;
  return expiryMs < Date.now() + 24 * 60 * 60 * 1000;
}

async function resignString(value: string): Promise<string> {
  if (isGcsRef(value)) return signGcsRef(value);
  const path = extractPath(value);
  if (path && needsResigning(value)) return getSignedReadUrl(path);
  return value;
}

async function resignValue(value: unknown): Promise<unknown> {
  if (typeof value === 'string') return resignString(value);
  if (Array.isArray(value)) return Promise.all(value.map(resignValue));
  if (value !== null && typeof value === 'object') {
    const entries = await Promise.all(
      Object.entries(value as Record<string, unknown>).map(async ([k, v]) => [k, await resignValue(v)]),
    );
    return Object.fromEntries(entries);
  }
  return value;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ flowId: string }> },
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { flowId } = await params;

    const { data: flow, error } = await supabase
      .from('flows')
      .select('*')
      .eq('id', flowId)
      .single();

    if (error || !flow) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Re-sign thumbnail_url if it's a gcs: ref or an expired/malformed stored signed URL.
    let thumbnailUrl = flow.thumbnail_url as string | null;
    if (thumbnailUrl) thumbnailUrl = await resignString(thumbnailUrl);

    // Re-sign all URLs embedded in flow_data node data.
    const freshFlowData = await resignValue(flow.flow_data);

    return NextResponse.json({
      data: { ...flow, thumbnail_url: thumbnailUrl, flow_data: freshFlowData },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[flows/[flowId]] GET error:', detail);
    return NextResponse.json({ error: 'Failed to load flow' }, { status: 500 });
  }
}
