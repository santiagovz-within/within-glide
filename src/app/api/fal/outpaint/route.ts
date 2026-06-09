import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fal } from '@fal-ai/client';
import { uploadToGCS, getSignedReadUrl } from '@/lib/gcs';

fal.config({ credentials: process.env.FAL_KEY });

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      imageUrl,
      expandTop    = 0,
      expandRight  = 0,
      expandBottom = 0,
      expandLeft   = 0,
      sourceType   = 'canvas',
      nodeId,
    } = await request.json();

    if (!imageUrl) return NextResponse.json({ error: 'imageUrl required' }, { status: 400 });
    if (!expandTop && !expandRight && !expandBottom && !expandLeft) {
      return NextResponse.json({ error: 'No expansion specified' }, { status: 400 });
    }

    console.log('[fal/outpaint] input:', { imageUrl, expandTop, expandRight, expandBottom, expandLeft });

    const result = await fal.subscribe('fal-ai/flux-2-pro/outpaint', {
      input: {
        image_url:        imageUrl,
        ...(expandTop    > 0 ? { outpaint_top:    expandTop    } : {}),
        ...(expandRight  > 0 ? { outpaint_right:  expandRight  } : {}),
        ...(expandBottom > 0 ? { outpaint_bottom: expandBottom } : {}),
        ...(expandLeft   > 0 ? { outpaint_left:   expandLeft   } : {}),
      },
    });

    const d = result.data as Record<string, unknown>;
    console.log('[fal/outpaint] response keys:', Object.keys(d));

    const outputUrl =
      (d.images as Array<{ url: string }> | undefined)?.[0]?.url ??
      (d.image  as { url: string } | undefined)?.url;

    if (!outputUrl) {
      console.error('[fal/outpaint] no URL in response:', JSON.stringify(d));
      return NextResponse.json({ error: 'No image in response' }, { status: 500 });
    }

    const imageRes    = await fetch(outputUrl);
    const imageBuffer = await imageRes.arrayBuffer();
    const contentType = imageRes.headers.get('content-type') ?? 'image/webp';
    const ext         = contentType.split('/')[1] ?? 'webp';

    const genId      = crypto.randomUUID();
    const objectPath = `${user.id}/${genId}.${ext}`;
    const gcsRef     = await uploadToGCS(imageBuffer, objectPath, contentType);
    const signedUrl  = await getSignedReadUrl(objectPath);

    await supabase.from('generations').insert({
      id:          genId,
      user_id:     user.id,
      source_type: sourceType,
      node_id:     nodeId,
      model:       'flux-2-pro-outpaint',
      parameters:  { expandTop, expandRight, expandBottom, expandLeft },
      media_type:  'image',
      media_url:   gcsRef,
      status:      'completed',
    });

    return NextResponse.json({ mediaUrls: [signedUrl], status: 'completed' });
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    console.error('[fal/outpaint] error:', details);
    return NextResponse.json({ error: 'Outpaint failed', details }, { status: 500 });
  }
}
