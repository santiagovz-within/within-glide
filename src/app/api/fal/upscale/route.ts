import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fal } from '@fal-ai/client';
import { FAL_MODELS } from '@/lib/api/models';

fal.config({ credentials: process.env.FAL_KEY });

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { model, imageUrl, scaleFactor = 2, sourceType, nodeId } = await request.json();

    const modelConfig = FAL_MODELS[model as keyof typeof FAL_MODELS];
    if (!modelConfig || modelConfig.type !== 'upscale') {
      return NextResponse.json({ error: 'Invalid upscale model' }, { status: 400 });
    }

    const result = await fal.subscribe(modelConfig.endpoint, {
      input: {
        image_url: imageUrl,
        scale: scaleFactor,
      },
    });

    const falResult = result.data as { image?: { url: string }; output_image?: { url: string } };
    const outputUrl = falResult.image?.url ?? falResult.output_image?.url;
    if (!outputUrl) {
      return NextResponse.json({ error: 'Upscale returned no image' }, { status: 500 });
    }

    // Download and store
    const imageRes = await fetch(outputUrl);
    const imageBuffer = await imageRes.arrayBuffer();
    const contentType = imageRes.headers.get('content-type') ?? 'image/webp';
    const ext = contentType.split('/')[1] ?? 'webp';

    const genId = crypto.randomUUID();
    const storagePath = `${user.id}/${genId}.${ext}`;

    await supabase.storage
      .from('generations')
      .upload(storagePath, imageBuffer, { contentType, upsert: false });

    const { data: { publicUrl } } = supabase.storage.from('generations').getPublicUrl(storagePath);

    await supabase.from('generations').insert({
      id: genId,
      user_id: user.id,
      source_type: sourceType ?? 'canvas',
      node_id: nodeId,
      model,
      parameters: { scaleFactor },
      media_type: 'image',
      media_url: publicUrl,
      status: 'completed',
    });

    return NextResponse.json({ mediaUrls: [publicUrl], status: 'completed' });
  } catch (err) {
    console.error('Upscale error:', err);
    return NextResponse.json({ error: 'Upscale failed', details: String(err) }, { status: 500 });
  }
}
