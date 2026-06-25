import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { signGcsRef, isGcsRef, getSignedReadUrl } from '@/lib/gcs';
import { isSignedGcsUrl, extractGcsPathFromSignedUrl } from '@/lib/utils/mediaUtils';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { paths } = await request.json() as { paths: string[] };
  if (!Array.isArray(paths) || paths.length === 0) {
    return NextResponse.json({ urls: {} });
  }

  // Accept both canonical gcs: refs (new records) and stored signed GCS URLs (old records).
  // Signed URLs may be stale or have been signed with a malformed key — always re-sign fresh.
  const signable = paths.filter(p => isGcsRef(p) || isSignedGcsUrl(p));

  const entries = await Promise.all(
    signable.map(async (ref) => {
      let url: string;
      if (isGcsRef(ref)) {
        url = await signGcsRef(ref);
      } else {
        const path = extractGcsPathFromSignedUrl(ref)!;
        url = await getSignedReadUrl(path);
      }
      return [ref, url] as [string, string];
    })
  );

  return NextResponse.json({ urls: Object.fromEntries(entries) });
}
