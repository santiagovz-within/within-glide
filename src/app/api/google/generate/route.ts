import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { GoogleGenAI } from '@google/genai';
import { GOOGLE_IMAGE_MODELS } from '@/lib/api/models';

interface GenerateBody {
  model: string;
  prompt: string;
  aspectRatio?: string;
  numImages?: number;
  sourceType: 'canvas' | 'chat';
  sourceId?: string;
  nodeId?: string;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body: GenerateBody = await request.json();
    const { model, prompt, aspectRatio = '1:1', numImages = 1, sourceType, sourceId, nodeId } = body;

    const googleModelId = GOOGLE_IMAGE_MODELS[model];
    if (!googleModelId) {
      return NextResponse.json({ error: `Unknown Google model: ${model}` }, { status: 400 });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });

    // Include aspect ratio in the prompt since Gemini image models read it from context
    const aspectHint = aspectRatio !== '1:1' ? ` Use a ${aspectRatio} aspect ratio.` : '';
    const fullPrompt = prompt + aspectHint;

    const mediaUrls: string[] = [];

    // Each generateContent call produces one image; loop for multiple
    for (let i = 0; i < numImages; i++) {
      const response = await ai.models.generateContent({
        model: googleModelId,
        contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
        config: {
          responseModalities: ['TEXT', 'IMAGE'],
        },
      });

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (!part.inlineData?.data) continue;

        const imageBytes = part.inlineData.data; // base64 string
        const mimeType = part.inlineData.mimeType ?? 'image/png';
        const ext = mimeType.split('/')[1] ?? 'png';

        const binary = Buffer.from(imageBytes, 'base64');
        const genId = crypto.randomUUID();
        const storagePath = `${user.id}/${genId}.${ext}`;

        await supabase.storage
          .from('generations')
          .upload(storagePath, binary, { contentType: mimeType, upsert: false });

        const { data: { publicUrl } } = supabase.storage.from('generations').getPublicUrl(storagePath);

        await supabase.from('generations').insert({
          id: genId,
          user_id: user.id,
          source_type: sourceType,
          source_id: sourceId,
          node_id: nodeId,
          model,
          prompt,
          parameters: { aspectRatio },
          media_type: 'image',
          media_url: publicUrl,
          status: 'completed',
        });

        mediaUrls.push(publicUrl);
        break; // one image per response
      }
    }

    if (mediaUrls.length === 0) {
      return NextResponse.json({ error: 'No images returned by the model' }, { status: 500 });
    }

    return NextResponse.json({ mediaUrls, status: 'completed' });
  } catch (err) {
    const details = err instanceof Error ? err.message : JSON.stringify(err);
    console.error('Google generate error:', details);
    return NextResponse.json({ error: 'Generation failed', details }, { status: 500 });
  }
}
