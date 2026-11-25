import { NextRequest, NextResponse } from 'next/server';
import { fal } from '@fal-ai/client';
import { createClient } from '@/lib/supabase/server';
import { buildMusicInput } from '@/lib/api/music';
import { getFalStorageHeaders } from '@/lib/falStorage';
import { registerGenerationAttempt } from '@/lib/generationAttempt';
import { FlowClientError, isClientId } from '@/lib/flowClients';
import { describeFalError } from '@/lib/falErrors';

fal.config({ credentials: process.env.FAL_KEY });

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await request.json().catch(() => null);
    let settings;
    try {
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid music request.');
      settings = buildMusicInput(body);
      if (!isClientId(body.sourceId) || !isClientId(body.generationRunId)) throw new Error('A saved session or canvas is required.');
      if (body.sourceType === 'canvas') {
        if (typeof body.nodeId !== 'string' || typeof body.previousIdentity !== 'string') throw new Error('A saved canvas node is required.');
      } else if (body.sourceType !== 'chat') {
        throw new Error('Invalid music source.');
      }
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 400 });
    }
    const { model, input, duration, outputFormat } = settings;
    if (body.sourceType === 'chat') {
      const { data: session, error } = await supabase.from('chat_sessions').select('id')
        .eq('id', body.sourceId).eq('user_id', user.id).eq('kind', 'audio').maybeSingle();
      if (error) throw new FlowClientError('Could not verify the recording session.', 503);
      if (!session) throw new FlowClientError('Recording session not found.', 404);
    }
    const headers = await getFalStorageHeaders({ userId: user.id, sourceType: body.sourceType, sourceId: body.sourceId });
    await registerGenerationAttempt(supabase, user.id, body);
    // Reserve storage before starting paid work (also catches a missing audio migration).
    const id = crypto.randomUUID();
    const { error: insertError } = await supabase.from('generations').insert({
      id, user_id: user.id, source_type: body.sourceType, source_id: body.sourceId,
      node_id: body.sourceType === 'canvas' ? body.nodeId : null,
      model: model.id, prompt: input.prompt, media_type: 'audio', media_url: '', status: 'pending',
      duration_seconds: duration,
      parameters: { endpoint: model.endpoint, duration, outputFormat, slotIndex: body.slotIndex,
        generationRunId: body.generationRunId, generationSlotCount: body.generationSlotCount },
    });
    if (insertError) throw new Error(`Could not save music generation: ${insertError.message}`);
    let requestId: string;
    try {
      ({ request_id: requestId } = await fal.queue.submit(model.endpoint, { input, headers }));
    } catch (error) {
      await supabase.from('generations').update({ status: 'failed', error_message: describeFalError(error) }).eq('id', id).eq('user_id', user.id);
      throw error;
    }
    const { error: updateError } = await supabase.from('generations')
      .update({ fal_request_id: requestId, status: 'processing' }).eq('id', id).eq('user_id', user.id);
    if (updateError) {
      await fal.queue.cancel(model.endpoint, { requestId }).catch(() => undefined);
      throw new Error(`Could not save queued music generation: ${updateError.message}`);
    }
    return NextResponse.json({ status: 'pending', requests: [{ requestId, endpoint: model.endpoint, generationId: id }] });
  } catch (error) {
    if (error instanceof FlowClientError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: 'Music generation failed', details: describeFalError(error) }, { status: 500 });
  }
}
