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
        systemInstruction: `You are an expert prompt engineer specializing in AI ${mediaType} generation${modelName ? ` with ${modelName}` : ''}. Enhance the following prompt to be more descriptive, vivid, and effective for generating high-quality ${mediaType}s. Add specific details about style, lighting, composition, atmosphere, and technical qualities. Keep the user's core intent intact. Return ONLY the enhanced prompt text, nothing else — no preamble, no explanation, no quotes.`,
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
