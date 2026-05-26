import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fal } from '@fal-ai/client';
import { FAL_MODELS } from '@/lib/api/models';
import { uploadToGCS, getSignedReadUrl } from '@/lib/gcs';
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
      const startFrameUrl = (body as GenerateRequestBody & { startFrameUrl?: string }).startFrameUrl;
      const endFrameUrl   = (body as GenerateRequestBody & { endFrameUrl?: string }).endFrameUrl;
      const hasImage = !!startFrameUrl;

      const endpoint = hasImage && 'imageToVideoEndpoint' in modelConfig
        ? modelConfig.imageToVideoEndpoint
        : modelConfig.endpoint;

      const { request_id } = await fal.queue.submit(endpoint as string, {
        input: {
          prompt,
          ...(!hasImage ? { aspect_ratio: aspectRatio } : {}),
          duration: String(body.duration ?? 5),
          ...(startFrameUrl ? { start_image_url: startFrameUrl } : {}),
          ...(endFrameUrl   ? { end_image_url: endFrameUrl } : {}),
        },
      });

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
    const supportsResolution = 'supportsResolution' in modelConfig && (modelConfig as { supportsResolution: boolean }).supportsResolution;
    const editImageParam = 'editImageParam' in modelConfig ? (modelConfig as { editImageParam: string }).editImageParam : null;
    const hasOwnQuality = 'hasOwnQuality' in modelConfig && (modelConfig as { hasOwnQuality: boolean }).hasOwnQuality;

    console.log('[fal/generate] endpoint:', endpoint, '| refs:', referenceImageUrls.length, '| usesAspectRatio:', usesAspectRatio, '| editImageParam:', editImageParam);

    for (let i = 0; i < numImages; i++) {
      const baseInput: Record<string, unknown> = {
        prompt,
        ...(usesAspectRatio
          ? { aspect_ratio: aspectRatio, ...(supportsResolution ? { resolution } : {}) }
          : hasOwnQuality
            ? { image_size: { width, height }, quality: body.quality ?? 'high' }
            : { image_size: { width, height }, num_inference_steps: body.quality === 'high' ? 40 : body.quality === 'low' ? 20 : 28 }),
        ...(body.negativePrompt ? { negative_prompt: body.negativePrompt } : {}),
      };

      if (referenceImageUrls[0]) {
        if (editImageParam === 'image_urls') {
          baseInput.image_urls = referenceImageUrls.filter(Boolean);
        } else {
          baseInput.image_url = referenceImageUrls[0];
        }
      }

      console.log(`[fal/generate] image ${i + 1}/${numImages} input:`, JSON.stringify(baseInput));
      const result = await fal.subscribe(endpoint as string, { input: baseInput });

      const falResult = result.data as { images?: Array<{ url: string }>; image?: { url: string } };
      const imageUrl = falResult.images?.[0]?.url ?? falResult.image?.url;
      if (!imageUrl) continue;

      const imageRes = await fetch(imageUrl);
      const imageBuffer = await imageRes.arrayBuffer();
      const contentType = imageRes.headers.get('content-type') ?? 'image/webp';
      const ext = contentType.split('/')[1] ?? 'webp';

      const genId = crypto.randomUUID();
      const objectPath = `${user.id}/${genId}.${ext}`;
      const gcsRef = await uploadToGCS(imageBuffer, objectPath, contentType);
      const signedUrl = await getSignedReadUrl(objectPath);

      await supabase
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
          media_url: gcsRef,
          width,
          height,
          status: 'completed',
        });

      results.push(signedUrl);
    }

    if (results.length === 0) {
      return NextResponse.json({ error: 'Generation failed' }, { status: 500 });
    }

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
