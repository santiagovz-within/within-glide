import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { uploadToGCS, getSignedReadUrl } from '@/lib/gcs';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { dataUrl, flowId } = await request.json();
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/jpeg;base64,')) {
      return NextResponse.json({ error: 'Expected a JPEG data URL' }, { status: 400 });
    }

    const base64 = dataUrl.slice('data:image/jpeg;base64,'.length);
    const buffer = Buffer.from(base64, 'base64');

    // Use a stable path per flow so we overwrite on each save instead of accumulating files
    const slug = flowId ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const objectPath = `thumbnails/${user.id}/${slug}.jpg`;

    const ref = await uploadToGCS(buffer, objectPath, 'image/jpeg');
    const url = await getSignedReadUrl(objectPath);

    // Return both: `ref` (canonical gcs: path) for DB storage, `url` for immediate display.
    return NextResponse.json({ url, ref });
  } catch (err) {
    console.error('Thumbnail upload error:', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
