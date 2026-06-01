import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { GoogleGenAI } from '@google/genai';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ title: 'New Session' });

    const { prompt } = await request.json();
    if (!prompt?.trim()) return NextResponse.json({ title: 'New Session' });

    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ role: 'user', parts: [{ text: prompt.slice(0, 300) }] }],
      config: {
        systemInstruction:
          'Generate a short session title (3–5 words max) that captures the main subject of this image/video generation prompt. Return ONLY the title — no quotes, no punctuation, no explanation.',
      },
    });

    const title = response.text?.trim().slice(0, 60) ?? 'New Session';
    return NextResponse.json({ title });
  } catch {
    return NextResponse.json({ title: 'New Session' });
  }
}
