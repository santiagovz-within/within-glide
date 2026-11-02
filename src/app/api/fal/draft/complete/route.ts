import { FlowClientError } from '@/lib/flowClients';
import { NextRequest, NextResponse } from 'next/server';
import { ApiError, fal } from '@fal-ai/client';
import { createClient } from '@/lib/supabase/server';
import { registerGenerationAttempt, type GenerationAttemptInput } from '@/lib/generationAttempt';
import { getFalStorageHeaders } from '@/lib/falStorage';
import { describeFalError } from '@/lib/falErrors';
import { canCompleteSeedanceDraft, SEEDANCE_DRAFT_COMPLETE_ENDPOINT, videoGenerationMetadata } from '@/lib/seedanceDraft';

fal.config({ credentials: process.env.FAL_KEY });

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await request.json() as GenerationAttemptInput & { draftGenerationId?: string };
    if (typeof body.draftGenerationId !== 'string' || !body.draftGenerationId
      || body.sourceType !== 'canvas' || typeof body.sourceId !== 'string' || !body.sourceId
      || typeof body.nodeId !== 'string' || !body.nodeId
      || typeof body.generationRunId !== 'string' || !body.generationRunId
      || typeof body.previousIdentity !== 'string') {
      return NextResponse.json({ error: 'Select a saved draft in a video node.' }, { status: 400 });
    }

    // Never trust a client-supplied draft ID, resolution, prompt, or references.
    const { data: draft, error: lookupError } = await supabase.from('generations')
      .select('id, model, status, parameters, created_at, prompt, reference_image_urls')
      .eq('id', body.draftGenerationId).eq('user_id', user.id).maybeSingle();
    if (lookupError) throw new Error('Could not load this draft.');
    if (!draft) return NextResponse.json({ error: 'Draft not found.' }, { status: 404 });
    const metadata = videoGenerationMetadata(draft);
    if (draft.model !== 'seedance-2-5' || draft.status !== 'completed' || !metadata.isDraft || !metadata.draftId) {
      return NextResponse.json({ error: 'This video is not a completed Seedance 2.5 draft.' }, { status: 400 });
    }
    const original = draft.parameters as Record<string, unknown>;
    if (typeof original.draftCompletionGenerationId === 'string') {
      const { data: existing, error } = await supabase.from('generations').select('status')
        .eq('id', original.draftCompletionGenerationId).eq('user_id', user.id).maybeSingle();
      if (error) throw new Error('Could not check the previous completion.');
      // Only a confirmed failed attempt can be retried. An interrupted submit may have been billed.
      if (existing?.status !== 'failed') {
        return NextResponse.json({ error: existing?.status === 'completed'
          ? 'This draft already has a 1080p result. Reopen its flow to view the completed version.'
          : 'A 1080p completion has already been submitted for this draft. Wait for that request to finish.' }, { status: 409 });
      }
    }
    if (!canCompleteSeedanceDraft(metadata)) {
      return NextResponse.json({ error: 'This draft has expired. Generate a new draft to render at 1080p.' }, { status: 410 });
    }

    const headers = await getFalStorageHeaders({ userId: user.id, sourceType: 'canvas', sourceId: body.sourceId });
    await registerGenerationAttempt(supabase, user.id, body);
    const generationId = crypto.randomUUID();
    const reserved = { ...original, draftCompletionGenerationId: generationId };
    // Atomic compare-and-swap on the existing JSON column works across tabs and servers,
    // without a schema migration or a process-local lock.
    const { data: claimed, error: claimError } = await supabase.from('generations')
      .update({ parameters: reserved }).eq('id', draft.id).eq('user_id', user.id)
      .eq('parameters', JSON.stringify(original)).select('id');
    if (claimError) throw new Error('Could not reserve this draft for completion.');
    if (!claimed?.length) {
      return NextResponse.json({ error: 'This draft changed in another tab. Reopen the flow before trying again.' }, { status: 409 });
    }

    let submissionStarted = false;
    let queued = false;
    try {
      const { error: insertError } = await supabase.from('generations').insert({
        id: generationId, user_id: user.id, source_type: 'canvas', source_id: body.sourceId, node_id: body.nodeId,
        model: 'seedance-2-5', prompt: draft.prompt, reference_image_urls: draft.reference_image_urls ?? [],
        media_type: 'video', media_url: '', status: 'processing',
        parameters: {
          generationRunId: body.generationRunId, endpoint: SEEDANCE_DRAFT_COMPLETE_ENDPOINT,
          sourceDraftGenerationId: draft.id, resolution: '1080p', draft: false,
          aspectRatio: original.aspectRatio, duration: original.duration, generateAudio: original.generateAudio,
          referenceVideoUrls: original.referenceVideoUrls ?? [], input: original.input,
        },
      });
      if (insertError) throw new Error('Could not save the completion request.');
      submissionStarted = true;
      const { request_id } = await fal.queue.submit(SEEDANCE_DRAFT_COMPLETE_ENDPOINT, {
        input: { draft_id: metadata.draftId, resolution: '1080p' }, headers,
      });
      queued = true;
      const { error: saveError } = await supabase.from('generations').update({ fal_request_id: request_id })
        .eq('id', generationId).eq('user_id', user.id);
      if (saveError) {
        // Retain the provider ID on the reservation for troubleshooting a database outage.
        await supabase.from('generations').update({ parameters: { ...reserved, draftCompletionRequestId: request_id } })
          .eq('id', draft.id).eq('user_id', user.id).eq('parameters', JSON.stringify(reserved));
        throw new Error(`Completion was queued (${request_id}), but could not be saved. Do not submit it again.`);
      }
      return NextResponse.json({ generationId, requestId: request_id, endpoint: SEEDANCE_DRAFT_COMPLETE_ENDPOINT, status: 'pending' });
    } catch (error) {
      const rejected = !queued && error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408;
      if (!submissionStarted || rejected) {
        await supabase.from('generations').update({ status: 'failed', error_message: describeFalError(error) })
          .eq('id', generationId).eq('user_id', user.id);
        if (!submissionStarted) {
          await supabase.from('generations').update({ parameters: original }).eq('id', draft.id)
            .eq('user_id', user.id).eq('parameters', JSON.stringify(reserved));
        }
      }
      // A timeout or transport error is ambiguous: retain the reservation to avoid a second charge.
      throw error;
    }
  } catch (error) {
    if (error instanceof FlowClientError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Draft completion error:', describeFalError(error));
    return NextResponse.json({ error: describeFalError(error) }, { status: 500 });
  }
}
