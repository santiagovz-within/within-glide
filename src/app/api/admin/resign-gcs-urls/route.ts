import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { getSignedReadUrl } from '@/lib/gcs';

const BUCKET = process.env.GCS_BUCKET_NAME ?? 'within-glide';
// Matches any signed GCS URL for our bucket
const GCS_URL_RE = new RegExp(
  `https://storage\\.googleapis\\.com/${BUCKET}/([^?]+)\\?.*Signature=`,
);

/** Extracts the raw object path from a signed GCS URL, or null if not a match. */
function extractPath(url: string): string | null {
  const m = url.match(GCS_URL_RE);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Recursively walks any JSON value, re-signing every stale GCS signed URL. */
async function resignValue(value: unknown): Promise<{ value: unknown; count: number }> {
  if (typeof value === 'string') {
    const path = extractPath(value);
    if (path) {
      const url = await getSignedReadUrl(path);
      return { value: url, count: 1 };
    }
    return { value, count: 0 };
  }
  if (Array.isArray(value)) {
    let count = 0;
    const arr: unknown[] = [];
    for (const item of value) {
      const r = await resignValue(item);
      arr.push(r.value);
      count += r.count;
    }
    return { value: arr, count };
  }
  if (value !== null && typeof value === 'object') {
    let count = 0;
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const r = await resignValue(v);
      obj[k] = r.value;
      count += r.count;
    }
    return { value: obj, count };
  }
  return { value, count: 0 };
}

// POST — re-signs all stale GCS signed URLs stored in flow_data and thumbnail_url
// across ALL users. Safe to run multiple times.
export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabase
      .from('profiles').select('is_admin').eq('id', user.id).single();
    if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const adminDb = createAdminClient();
    const { data: flows, error } = await adminDb
      .from('flows')
      .select('id, thumbnail_url, flow_data');

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!flows?.length) return NextResponse.json({ updated: 0, skipped: 0, failed: 0, total: 0 });

    let updated = 0, skipped = 0, failed = 0;

    for (const flow of flows) {
      try {
        const updates: Record<string, unknown> = {};
        let urlsResigned = 0;

        // Re-sign thumbnail_url if it's a stale signed URL
        if (flow.thumbnail_url && extractPath(flow.thumbnail_url as string)) {
          const path = extractPath(flow.thumbnail_url as string)!;
          updates.thumbnail_url = await getSignedReadUrl(path);
          urlsResigned++;
        }

        // Walk every node's data in flow_data and re-sign URLs
        if (flow.flow_data) {
          const r = await resignValue(flow.flow_data);
          urlsResigned += r.count;
          if (r.count > 0) updates.flow_data = r.value;
        }

        if (urlsResigned === 0) { skipped++; continue; }

        await adminDb.from('flows').update(updates).eq('id', flow.id);
        updated++;
      } catch {
        failed++;
      }
    }

    // Also re-sign chat_sessions thumbnail_url values that are signed URLs
    // (gcs: refs are fine since they're resolved at display time)
    let sessionsUpdated = 0;
    const { data: sessions } = await adminDb
      .from('chat_sessions')
      .select('id, thumbnail_url')
      .not('thumbnail_url', 'is', null);

    for (const session of sessions ?? []) {
      const path = extractPath(session.thumbnail_url as string);
      if (!path) continue;
      try {
        const url = await getSignedReadUrl(path);
        await adminDb.from('chat_sessions').update({ thumbnail_url: url }).eq('id', session.id);
        sessionsUpdated++;
      } catch { /* skip */ }
    }

    return NextResponse.json({
      flows: { updated, skipped, failed, total: flows.length },
      sessions: { updated: sessionsUpdated },
    });
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'Failed', details }, { status: 500 });
  }
}
