import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fal } from '@fal-ai/client';
import { FAL_MODELS } from '@/lib/api/models';
import type { GenerateImageRequest } from '@/types';

fal.config({ credentials: process.env.FAL_KEY });

interface GenerateRequestBody extends GenerateImageRequest {
  sourceType: 'canvas' | 'chat';
  sourceId?: string;
  nodeId?: string;
  quality?: string;
  duration?: number;
}

function getImageSize(aspectRatio: string, resolution: string): { width: number; height: number } {
  const baseSize = resolution === '4K' ? 3840 : resolution === '2K' ? 2048 : 1024;
  const [w, h] = aspectRatio.split(':').map(Number);
  const ratio = w / h;

  if (ratio >= 1) {
    return { width: baseSize, height: Math.round(baseSize / ratio) };
  } else {
    return { width: Math.round(baseSize * ratio), height: baseSize };
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body: GenerateRequestBody = await request.json();
    const { model, prompt, aspectRatio = '1:1', resolution = '1K', numImages = 1, referenceImageUrls = [], sourceType, sourceId, nodeId } = body;

    const modelConfig = FAL_MODELS[model as keyof typeof FAL_MODELS];
    if (!modelConfig) return NextResponse.json({ error: 'Unknown model' }, { status: 400 });

    if (modelConfig.type === 'video') {
      // Video generation — submit async job
      const endpoint = referenceImageUrls.length > 0 && 'imageToVideoEndpoint' in modelConfig
        ? modelConfig.imageToVideoEndpoint
        : modelConfig.endpoint;

      const { request_id } = await fal.queue.submit(endpoint as string, {
        input: {
          prompt,
          aspect_ratio: aspectRatio,
          duration: body.duration ?? 5,
          ...(referenceImageUrls[0] ? { image_url: referenceImageUrls[0] } : {}),
        },
      });

      // Create a pending generation record
      const { data: gen } = await supabase
        .from('generations')
        .insert({
          user_id: user.id,
          source_type: sourceType,
          source_id: sourceId,
          node_id: nodeId,
          model,
          prompt,
          parameters: { aspectRatio, resolution },
          reference_image_urls: referenceImageUrls,
          media_type: 'video',
          media_url: '',
          status: 'processing',
          fal_request_id: request_id,
        })
        .select()
        .single();

      return NextResponse.json({ generationId: gen?.id, requestId: request_id, status: 'pending' });
    }

    // Image generation — synchronous
    const { width, height } = getImageSize(aspectRatio, resolution);
    const results: string[] = [];

    const useEditEndpoint = referenceImageUrls.length > 0 && 'editEndpoint' in modelConfig;
    const endpoint = useEditEndpoint ? modelConfig.editEndpoint : modelConfig.endpoint;
    const usesAspectRatio = 'usesAspectRatio' in modelConfig && modelConfig.usesAspectRatio;

    for (let i = 0; i < numImages; i++) {
      const result = await fal.subscribe(endpoint as string, {
        input: {
          prompt,
          ...(usesAspectRatio
            ? { aspect_ratio: aspectRatio }
            : { image_size: { width, height }, num_inference_steps: body.quality === 'high' ? 40 : body.quality === 'low' ? 20 : 28 }),
          ...(body.negativePrompt ? { negative_prompt: body.negativePrompt } : {}),
          ...(referenceImageUrls[0] ? { image_url: referenceImageUrls[0] } : {}),
        },
      });

      const falResult = result.data as { images?: Array<{ url: string }>; image?: { url: string } };
      const imageUrl = falResult.images?.[0]?.url ?? falResult.image?.url;
      if (!imageUrl) continue;

      // Download and store in Supabase Storage
      const imageRes = await fetch(imageUrl);
      const imageBuffer = await imageRes.arrayBuffer();
      const contentType = imageRes.headers.get('content-type') ?? 'image/webp';
      const ext = contentType.split('/')[1] ?? 'webp';

      const genId = crypto.randomUUID();
      const storagePath = `${user.id}/${genId}.${ext}`;

      await supabase.storage
        .from('generations')
        .upload(storagePath, imageBuffer, { contentType, upsert: false });

      const { data: { publicUrl } } = supabase.storage.from('generations').getPublicUrl(storagePath);

      const { data: gen } = await supabase
        .from('generations')
        .insert({
          id: genId,
          user_id: user.id,
          source_type: sourceType,
          source_id: sourceId,
          node_id: nodeId,
          model,
          prompt,
          parameters: { aspectRatio, resolution },
          reference_image_urls: referenceImageUrls,
          media_type: 'image',
          media_url: publicUrl,
          width,
          height,
          status: 'completed',
        })
        .select()
        .single();

      if (gen) results.push(publicUrl);
    }

    if (results.length === 0) {
      return NextResponse.json({ error: 'Generation failed' }, { status: 500 });
    }

    // Return the generationId of the last created generation
    const { data: lastGen } = await supabase
      .from('generations')
      .select('id')
      .eq('user_id', user.id)
      .eq('source_type', sourceType)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    return NextResponse.json({ generationId: lastGen?.id, mediaUrls: results, status: 'completed' });
  } catch (err) {
    const details = err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null
        ? JSON.stringify(err)
        : String(err);
    console.error('Generation error:', details);
    return NextResponse.json({ error: 'Generation failed', details }, { status: 500 });
  }
}
