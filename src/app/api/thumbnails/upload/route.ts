import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { uploadToGCS } from '@/lib/gcs';

const TARGET_BYTES = 150 * 1024;
const MAX_SOURCE_BYTES = 30 * 1024 * 1024;
const JPEG_DATA_URL_PREFIX = 'data:image/jpeg;base64,';

async function compressThumbnail(input: Buffer): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  let result = await sharp(input, { limitInputPixels: 64_000_000 })
    .rotate()
    .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 74, mozjpeg: true })
    .toBuffer();

  if (result.byteLength > TARGET_BYTES) {
    result = await sharp(input, { limitInputPixels: 64_000_000 })
      .rotate()
      .resize(360, 360, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 62, mozjpeg: true })
      .toBuffer();
  }
  if (result.byteLength > TARGET_BYTES) {
    result = await sharp(input, { limitInputPixels: 64_000_000 })
      .rotate()
      .resize(280, 280, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 52, mozjpeg: true })
      .toBuffer();
  }
  return result;
}

function isAllowedImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    if (url.hostname === 'storage.googleapis.com' || url.hostname.endsWith('.storage.googleapis.com')) {
      return true;
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    return !!supabaseUrl && url.hostname === new URL(supabaseUrl).hostname;
  } catch {
    return false;
  }
}

async function readSourceImage(sourceUrl: string): Promise<Buffer> {
  if (!isAllowedImageUrl(sourceUrl)) {
    throw new Error('Unsupported thumbnail source URL');
  }

  const response = await fetch(sourceUrl, {
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Thumbnail source returned ${response.status}`);

  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > MAX_SOURCE_BYTES) throw new Error('Thumbnail source is too large');

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType && !contentType.startsWith('image/') && contentType !== 'application/octet-stream') {
    throw new Error('Thumbnail source is not an image');
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_SOURCE_BYTES) {
    throw new Error('Thumbnail source has an invalid size');
  }
  return buffer;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json() as {
      dataUrl?: string;
      sourceUrl?: string;
      flowId?: string;
    };
    const flowId = body.flowId;
    if (!flowId || !/^[a-f0-9-]{36}$/i.test(flowId)) {
      return NextResponse.json({ error: 'Invalid flow ID' }, { status: 400 });
    }

    const { data: flow } = await supabase
      .from('flows')
      .select('id')
      .eq('id', flowId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!flow) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    let sourceBuffer: Buffer;
    if (body.sourceUrl) {
      sourceBuffer = await readSourceImage(body.sourceUrl);
    } else if (body.dataUrl?.startsWith(JPEG_DATA_URL_PREFIX)) {
      sourceBuffer = Buffer.from(body.dataUrl.slice(JPEG_DATA_URL_PREFIX.length), 'base64');
      if (sourceBuffer.byteLength === 0 || sourceBuffer.byteLength > MAX_SOURCE_BYTES) {
        return NextResponse.json({ error: 'Invalid thumbnail data' }, { status: 400 });
      }
    } else {
      return NextResponse.json({ error: 'Expected an image source' }, { status: 400 });
    }

    const thumbnail = await compressThumbnail(sourceBuffer);
    const objectPath = `thumbnails/${user.id}/${flowId}.jpg`;
    const ref = await uploadToGCS(thumbnail, objectPath, 'image/jpeg');

    const { error: updateError } = await supabase
      .from('flows')
      .update({ thumbnail_url: ref })
      .eq('id', flowId)
      .eq('user_id', user.id);
    if (updateError) throw updateError;

    return NextResponse.json({ ref });
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    console.error('[thumbnails/upload] Failed:', details);
    return NextResponse.json({ error: 'Thumbnail generation failed' }, { status: 500 });
  }
}
