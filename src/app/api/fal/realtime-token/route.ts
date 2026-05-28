import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const app = new URL(request.url).searchParams.get('app') || 'fal-ai/fast-lcm-diffusion/image-to-image';

    // Parse alias: 'fal-ai/fast-lcm-diffusion/image-to-image' → 'fast-lcm-diffusion'
    const alias = app.split('/')[1];
    if (!alias) {
      return NextResponse.json({ error: 'Invalid app identifier' }, { status: 400 });
    }

    const falKey = process.env.FAL_KEY;
    if (!falKey) {
      console.error('[fal/realtime-token] FAL_KEY is not configured');
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }

    const response = await fetch('https://rest.fal.ai/tokens/', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${falKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        allowed_apps: [alias],
        token_expiration: 120,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[fal/realtime-token] FAL token request failed:', response.status, errorText);
      return NextResponse.json({ error: 'Failed to obtain realtime token' }, { status: 500 });
    }

    // FAL returns the token as a JSON-encoded string (e.g. `"eyJ..."` with quotes).
    // Parsing as JSON strips the surrounding quotes to give the bare JWT string.
    const raw = await response.text();
    const token: string = raw.startsWith('"') ? JSON.parse(raw) : raw;

    return NextResponse.json({ token });
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    console.error('[fal/realtime-token] Unexpected error:', details);
    return NextResponse.json({ error: 'Internal server error', details }, { status: 500 });
  }
}
