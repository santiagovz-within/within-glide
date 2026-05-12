import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

const LENGTH_INSTRUCTIONS: Record<string, string> = {
  short:  'Keep the output under 25 words.',
  medium: 'Keep the output between 25 and 70 words.',
  long:   'Keep the output between 70 and 150 words.',
  auto:   'Keep the output concise — only as long as the intent requires.',
};

export async function POST(request: NextRequest) {
  try {
    const { prompt, geminiModel = 'gemini-3-flash-preview', length = 'auto' } = await request.json();
    if (!prompt?.trim()) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });

    const lengthInstruction = LENGTH_INSTRUCTIONS[length] ?? LENGTH_INSTRUCTIONS.auto;

    const response = await ai.models.generateContent({
      model: geminiModel,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction: `You are a prompt engineer for AI image/video generation. Rewrite the user's prompt to be clearer and more precise — fix vague wording, add essential missing context, and make the intent unambiguous. Do NOT add decorative adjectives or artistic styles unless the user included them. Keep the user's core intent and tone. ${lengthInstruction} Return ONLY the improved prompt, nothing else.`,
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
