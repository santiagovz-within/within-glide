import { NextRequest, NextResponse } from 'next/server';
import { fal } from '@fal-ai/client';
import { createClient } from '@/lib/supabase/server';
import { getFalStorageHeaders } from '@/lib/falStorage';
import { describeFalError } from '@/lib/falErrors';
import { LAYERIZE_ENDPOINT } from '@/lib/layerize';

fal.config({ credentials: process.env.FAL_KEY });

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { imageUrl, sourceId, nodeId } = await request.json();
    if (typeof imageUrl !== 'string' || !/^https?:\/\//.test(imageUrl)) {
      return NextResponse.json({ error: 'A valid source image URL is required.' }, { status: 400 });
    }
    const headers = await getFalStorageHeaders({ userId: user.id, sourceType: 'canvas', sourceId });
    const { request_id } = await fal.queue.submit(LAYERIZE_ENDPOINT, {
      input: {
        image_url: imageUrl,
        prompt: 'Return name and description in English.',
        image_size: 'auto',
        enable_safety_checker: true,
      },
      headers,
    });
    const { error } = await supabase.from('generations').insert({
      user_id: user.id,
      source_type: 'canvas',
      source_id: sourceId,
      node_id: nodeId,
      model: LAYERIZE_ENDPOINT,
      parameters: { endpoint: LAYERIZE_ENDPOINT },
      media_type: 'image',
      media_url: '',
      status: 'processing',
      fal_request_id: request_id,
    });
    if (error) throw new Error(`Could not save Layerize request: ${error.message}`);
    return NextResponse.json({ requestId: request_id, status: 'pending' });
  } catch (error) {
    return NextResponse.json({ error: describeFalError(error) }, { status: 500 });
  }
}
