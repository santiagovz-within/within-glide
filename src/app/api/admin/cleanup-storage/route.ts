import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/server';

const BUCKET = 'uploads';
const PAGE_SIZE = 100;

// GET  — list all files in the uploads bucket (paginated via ?offset=N)
// POST — delete all files in the uploads bucket (runs in batches of 100)

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single();
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const offset = parseInt(request.nextUrl.searchParams.get('offset') ?? '0', 10);
  const admin = createAdminClient();

  const { data: files, error } = await admin.storage
    .from(BUCKET)
    .list('', { limit: PAGE_SIZE, offset, sortBy: { column: 'created_at', order: 'asc' } });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ files: files ?? [], count: files?.length ?? 0, offset });
}

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single();
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const admin = createAdminClient();
  let deleted = 0;
  let failed = 0;

  // List and delete all user-prefixed folders
  let offset = 0;
  while (true) {
    const { data: topLevel } = await admin.storage
      .from(BUCKET)
      .list('', { limit: PAGE_SIZE, offset });

    if (!topLevel?.length) break;

    for (const entry of topLevel) {
      // Each top-level entry is a user-id folder
      let fileOffset = 0;
      while (true) {
        const { data: files } = await admin.storage
          .from(BUCKET)
          .list(entry.name, { limit: PAGE_SIZE, offset: fileOffset });

        if (!files?.length) break;

        // Collect all nested paths
        const paths: string[] = [];
        for (const file of files) {
          if (file.id) {
            // It's a file
            paths.push(`${entry.name}/${file.name}`);
          } else {
            // It's a subfolder — go one level deeper
            const { data: nested } = await admin.storage
              .from(BUCKET)
              .list(`${entry.name}/${file.name}`, { limit: PAGE_SIZE, offset: 0 });
            if (nested?.length) {
              paths.push(...nested.filter(f => f.id).map(f => `${entry.name}/${file.name}/${f.name}`));
            }
          }
        }

        if (paths.length) {
          const { error } = await admin.storage.from(BUCKET).remove(paths);
          if (error) failed += paths.length;
          else deleted += paths.length;
        }

        fileOffset += files.length;
        if (files.length < PAGE_SIZE) break;
      }
    }

    offset += topLevel.length;
    if (topLevel.length < PAGE_SIZE) break;
  }

  return NextResponse.json({ deleted, failed });
}
