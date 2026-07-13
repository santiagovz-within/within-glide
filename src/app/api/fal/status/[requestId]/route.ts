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

    // The endpoint must match whatever was used to submit the job.
    // The client passes it as a query param so we don't have to hardcode a model.
    const endpoint = request.nextUrl.searchParams.get('endpoint')
      ?? 'fal-ai/kling-video/v3/pro/text-to-video';

    const status = await fal.queue.status(endpoint, {
      requestId,
      logs: false,
    });

    if (status.status === 'COMPLETED') {
      const result = await fal.queue.result(endpoint, { requestId });
      const falResult = result.data as { video?: { url: string } };
      const videoUrl = falResult.video?.url;

      if (!videoUrl) {
        return NextResponse.json({ status: 'failed', error: 'FAL returned no video URL in the result.' });
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

    const s = status as { status: string; queue_position?: number; error?: string };

    if (s.status === 'FAILED') {
      await supabase
        .from('generations')
        .update({ status: 'failed' })
        .eq('fal_request_id', requestId)
        .eq('user_id', user.id);
      return NextResponse.json({ status: 'failed', error: s.error ?? 'FAL reported the job failed.' });
    }

    return NextResponse.json({ status: 'pending', queuePosition: s.queue_position ?? null });
  } catch (err) {
    console.error('Status check error:', err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ status: 'error', error: detail }, { status: 500 });
  }
}
