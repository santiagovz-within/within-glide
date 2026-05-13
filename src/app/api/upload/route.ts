import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { MAX_UPLOAD_SIZE_BYTES } from '@/lib/utils/constants';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      return NextResponse.json({ error: 'File too large (max 35MB)' }, { status: 400 });
    }

    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
    }

    const ext = file.name.split('.').pop() ?? 'jpg';
    const filename = `${user.id}/refs/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    const { error } = await supabase.storage
      .from('uploads')
      .upload(filename, buffer, { contentType: file.type, upsert: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl(filename);

    return NextResponse.json({ url: publicUrl });
  } catch (err) {
    console.error('Upload error:', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
