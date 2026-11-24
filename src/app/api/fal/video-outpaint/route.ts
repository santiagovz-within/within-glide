import { FlowClientError } from '@/lib/flowClients';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fal } from '@fal-ai/client';
import { getFalStorageHeaders } from '@/lib/falStorage';
import { describeFalError } from '@/lib/falErrors';
import { buildVideoOutpaintInput, type VideoOutpaintRequest } from '@/lib/api/videoOutpaint';

fal.config({ credentials: process.env.FAL_KEY });

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json() as VideoOutpaintRequest & { sourceId?: string; nodeId?: string };
    const { sourceId, nodeId } = body;
    let requestConfig;
    try {
      requestConfig = buildVideoOutpaintInput(body);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid video expansion request.' }, { status: 400 });
    }
    const { model, input, aspectRatio, resolution } = requestConfig;
    const falHeaders = await getFalStorageHeaders({
      userId: user.id,
      sourceType: 'canvas',
      sourceId,
    });

    const { request_id } = await fal.queue.submit(model.endpoint, { input, headers: falHeaders });

    const { error: insertError } = await supabase.from('generations').insert({
      user_id: user.id,
      source_type: 'canvas',
      source_id: sourceId,
      node_id: nodeId ?? null,
      model: model.endpoint,
      prompt: typeof input.prompt === 'string' ? input.prompt : '',
      parameters: { aspectRatio, resolution, duration: body.duration, endpoint: model.endpoint, input },
      media_type: 'video',
      media_url: '',
      status: 'processing',
      fal_request_id: request_id,
    });

    if (insertError) {
      throw new Error(`Could not save queued video outpaint: ${insertError.message}`);
    }

    return NextResponse.json({ requestId: request_id, status: 'pending' });
  } catch (err) {
    if (err instanceof FlowClientError) return NextResponse.json({ error: err.message }, { status: err.status });
    const detail = describeFalError(err);
    console.error('[video-outpaint] submit error:', detail, err);
    return NextResponse.json({ error: 'Failed to submit outpaint job', details: detail }, { status: 500 });
  }
}
