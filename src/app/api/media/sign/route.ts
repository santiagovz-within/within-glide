import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { signGcsRef, isGcsRef } from '@/lib/gcs';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { paths } = await request.json() as { paths: string[] };
  if (!Array.isArray(paths) || paths.length === 0) {
    return NextResponse.json({ urls: {} });
  }

  const entries = await Promise.all(
    paths.filter(isGcsRef).map(async (ref) => {
      const url = await signGcsRef(ref);
      return [ref, url] as [string, string];
    })
  );

  return NextResponse.json({ urls: Object.fromEntries(entries) });
}
