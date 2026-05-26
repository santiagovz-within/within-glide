import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fal } from '@fal-ai/client';
import { uploadToGCS, getSignedReadUrl } from '@/lib/gcs';

fal.config({ credentials: process.env.FAL_KEY });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { requestId } = await params;

    const status = await fal.queue.status('fal-ai/kling-video/v2.1/pro/text-to-video', {
      requestId,
      logs: false,
    });

    if (status.status === 'COMPLETED') {
      const result = await fal.queue.result('fal-ai/kling-video/v2.1/pro/text-to-video', { requestId });
      const falResult = result.data as { video?: { url: string } };
      const videoUrl = falResult.video?.url;

      if (!videoUrl) {
        return NextResponse.json({ status: 'failed' });
      }

      const videoRes = await fetch(videoUrl);
      const videoBuffer = await videoRes.arrayBuffer();
      const genId = crypto.randomUUID();
      const objectPath = `${user.id}/${genId}.mp4`;
      const gcsRef = await uploadToGCS(videoBuffer, objectPath, 'video/mp4');
      const signedUrl = await getSignedReadUrl(objectPath);

      await supabase
        .from('generations')
        .update({
          media_url: gcsRef,
          status: 'completed',
          fal_request_id: requestId,
        })
        .eq('fal_request_id', requestId)
        .eq('user_id', user.id);

      const { data: gen } = await supabase
        .from('generations')
        .select('id')
        .eq('fal_request_id', requestId)
        .single();

      return NextResponse.json({
        status: 'completed',
        mediaUrls: [signedUrl],
        generationId: gen?.id,
      });
    }

    const inQueue = status as { status: string; queue_position?: number };
    if (inQueue.status === 'FAILED') {
      await supabase
        .from('generations')
        .update({ status: 'failed' })
        .eq('fal_request_id', requestId)
        .eq('user_id', user.id);
      return NextResponse.json({ status: 'failed' });
    }

    return NextResponse.json({ status: 'pending', queuePosition: inQueue.queue_position ?? null });
  } catch (err) {
    console.error('Status check error:', err);
    return NextResponse.json({ error: 'Status check failed' }, { status: 500 });
  }
}
