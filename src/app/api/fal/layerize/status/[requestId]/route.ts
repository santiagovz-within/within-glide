import { NextRequest, NextResponse } from 'next/server';
import { fal } from '@fal-ai/client';
import sharp from 'sharp';
import { createClient } from '@/lib/supabase/server';
import { signGcsRef } from '@/lib/gcs';
import { uploadMediaToGCS } from '@/lib/mediaDerivatives';
import { describeFalError, isTerminalFalError } from '@/lib/falErrors';
import { failGeneration } from '@/lib/generationFailures';
import { fetchFalQueueResult, getFalBillingColumns, mergeFalBillingParameters, persistFalBillingBestEffort } from '@/lib/falResult';
import { createEditableLayers, LAYERIZE_ENDPOINT, type EditableLayer, type FalLayer } from '@/lib/layerize';

fal.config({ credentials: process.env.FAL_KEY });
export const maxDuration = 300;

async function signLayers(layers: EditableLayer[]) {
  return Promise.all(layers.map(async layer => ({ ...layer, imageUrl: await signGcsRef(layer.imageUrl) })));
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { requestId } = await params;
    const { data: generation, error } = await supabase.from('generations')
      .select('id, status, media_url, parameters, error_message')
      .eq('fal_request_id', requestId).eq('user_id', user.id).eq('model', LAYERIZE_ENDPOINT).maybeSingle();
    if (error) throw new Error(error.message);
    if (!generation) return NextResponse.json({ error: 'Layerize request not found.' }, { status: 404 });
    if (generation.status === 'failed') {
      return NextResponse.json({ status: 'failed', error: generation.error_message });
    }
    if (generation.status === 'completed') {
      return NextResponse.json({
        status: 'completed',
        layers: await signLayers(generation.parameters.layers),
        imageUrl: await signGcsRef(generation.media_url),
      });
    }
    const status = await fal.queue.status(LAYERIZE_ENDPOINT, { requestId, logs: false });
    if (status.status !== 'COMPLETED') return NextResponse.json({ status: 'pending' });

    let result;
    try {
      result = await fetchFalQueueResult<{ layers: FalLayer[] }>(status.response_url, requestId);
    } catch (error) {
      if (!isTerminalFalError(error)) throw error;
      return failGeneration(supabase, user.id, requestId, describeFalError(error));
    }
    const rawLayers = result.data.layers;
    if (!Array.isArray(rawLayers) || rawLayers.length < 2 || rawLayers.length > 17 || rawLayers.some(layer => !layer.image?.url || !Number.isFinite(layer.z_index))) {
      return failGeneration(supabase, user.id, requestId, 'Layerize returned no valid layer set.');
    }
    rawLayers.sort((a, b) => a.z_index - b.z_index);
    if (rawLayers[0].z_index !== 0) return failGeneration(supabase, user.id, requestId, 'Layerize returned no background layer.');
    // Fetch all temporary outputs first, before their FAL storage window expires.
    const buffers = await Promise.all(rawLayers.map(async layer => {
      const response = await fetch(layer.image.url);
      if (!response.ok) throw new Error(`Could not download layer (${response.status}).`);
      return Buffer.from(await response.arrayBuffer());
    }));
    const metadata = await sharp(buffers[0]).metadata();
    const width = metadata.width!;
    const height = metadata.height!;
    const layers = createEditableLayers(rawLayers, width, height);
    const storedLayers = await Promise.all(layers.map(async (layer, index) => ({
      ...layer,
      imageUrl: await uploadMediaToGCS(buffers[index], `${user.id}/${generation.id}/layer-${index}.png`, 'image/png'),
    })));
    const overlays = await Promise.all(layers.map(async (layer, index) => {
      const layerWidth = Math.max(1, Math.round(layer.bounds.width));
      const layerHeight = Math.max(1, Math.round(layer.bounds.height));
      const x = Math.round(layer.bounds.x);
      const y = Math.round(layer.bounds.y);
      const left = Math.max(0, x);
      const top = Math.max(0, y);
      const clippedWidth = Math.min(width, x + layerWidth) - left;
      const clippedHeight = Math.min(height, y + layerHeight) - top;
      if (clippedWidth <= 0 || clippedHeight <= 0) return null;
      return {
        input: await sharp(buffers[index]).resize(layerWidth, layerHeight, { fit: 'fill' })
          .extract({ left: left - x, top: top - y, width: clippedWidth, height: clippedHeight }).png().toBuffer(),
        left,
        top,
      };
    }));
    const composition = await sharp({ create: { width, height, channels: 4, background: '#00000000' } })
      .composite(overlays.filter(overlay => overlay !== null)).png().toBuffer();
    const imageRef = await uploadMediaToGCS(composition, `${user.id}/${generation.id}.png`, 'image/png');
    const billing = await getFalBillingColumns(LAYERIZE_ENDPOINT, result.billableUnits);
    const { error: saveError } = await supabase.from('generations').update({
      status: 'completed',
      media_url: imageRef,
      parameters: mergeFalBillingParameters({ ...generation.parameters, layers: storedLayers }, billing),
    }).eq('id', generation.id).eq('user_id', user.id);
    if (saveError) throw new Error(`Could not save layers: ${saveError.message}`);
    await persistFalBillingBestEffort(billing, columns => supabase.from('generations').update(columns)
      .eq('id', generation.id).eq('user_id', user.id), `Layerize ${generation.id}`);
    return NextResponse.json({ status: 'completed', layers: await signLayers(storedLayers), imageUrl: await signGcsRef(imageRef) });
  } catch (error) {
    return NextResponse.json({ error: describeFalError(error) }, { status: 500 });
  }
}
