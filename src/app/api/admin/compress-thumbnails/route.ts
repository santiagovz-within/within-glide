import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const TARGET_BYTES = 150 * 1024;

async function sharpCompress(input: Buffer): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  let buf = await sharp(input)
    .resize(640, 640, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 72 })
    .toBuffer();
  if (buf.byteLength > TARGET_BYTES) {
    buf = await sharp(input)
      .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 62 })
      .toBuffer();
  }
  if (buf.byteLength > TARGET_BYTES) {
    buf = await sharp(input)
      .resize(300, 300, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 55 })
      .toBuffer();
  }
  return buf;
}

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabase
      .from('profiles').select('is_admin').eq('id', user.id).single();
    if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data: flows } = await supabase
      .from('flows')
      .select('id, thumbnail_url')
      .not('thumbnail_url', 'is', null);

    if (!flows?.length) return NextResponse.json({ updated: 0, skipped: 0, failed: 0, total: 0 });

    let updated = 0, skipped = 0, failed = 0;

    for (const flow of flows) {
      const thumb = flow.thumbnail_url as string;
      try {
        if (thumb.startsWith('data:')) {
          // ── Data URL (auto-generated thumbnail stored in DB) ──────────────
          const base64 = thumb.split(',')[1];
          if (!base64) { skipped++; continue; }
          const original = Buffer.from(base64, 'base64');
          if (original.byteLength <= TARGET_BYTES) { skipped++; continue; }
          const compressed = await sharpCompress(original);
          const newDataUrl = `data:image/jpeg;base64,${compressed.toString('base64')}`;
          await supabase.from('flows').update({ thumbnail_url: newDataUrl }).eq('id', flow.id);
          updated++;
        } else {
          // ── External URL (Supabase storage or GCS) ────────────────────────
          const res = await fetch(thumb);
          if (!res.ok) { failed++; continue; }
          const original = Buffer.from(await res.arrayBuffer());
          if (original.byteLength <= TARGET_BYTES) { skipped++; continue; }
          const compressed = await sharpCompress(original);
          const filename = `${user.id}/thumbnails/${flow.id}.jpg`;
          const { error: uploadErr } = await supabase.storage
            .from('uploads')
            .upload(filename, compressed, { contentType: 'image/jpeg', upsert: true });
          if (uploadErr) { failed++; continue; }
          const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl(filename);
          await supabase.from('flows').update({ thumbnail_url: publicUrl }).eq('id', flow.id);
          updated++;
        }
      } catch {
        failed++;
      }
    }

    return NextResponse.json({ updated, skipped, failed, total: flows.length });
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'Failed', details }, { status: 500 });
  }
}
