import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export async function POST(request: NextRequest) {
  try {
    const { prompt, mediaType = 'image', modelName = '' } = await request.json();
    if (!prompt?.trim()) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash-lite',
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      config: {
        systemInstruction: `You are a prompt engineer for AI ${mediaType} generation. Rewrite the user's prompt to be clearer and more precise — fix vague wording, add essential missing context, and make the intent unambiguous. Do NOT make it longer than necessary; do NOT add decorative adjectives or artistic styles unless the user included them. Keep the user's core intent and tone intact. Return ONLY the improved prompt, nothing else.`,
      },
    });

    const enhancedPrompt = response.text?.trim();
    if (!enhancedPrompt) {
      return NextResponse.json({ error: 'Enhancement failed' }, { status: 500 });
    }

    return NextResponse.json({ enhancedPrompt });
  } catch (err) {
    console.error('Prompt enhance error:', err);
    return NextResponse.json({ error: 'Enhancement failed', details: String(err) }, { status: 500 });
  }
}
