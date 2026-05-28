import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const CAP_USD = 4;
const COST_PER_SECOND = 0.00194; // fal-ai/flux-2/klein/realtime rate
const DEFAULT_COMPUTE_SECONDS = 2.0;

interface UsageRow {
  cost_usd: number;
  request_count: number;
  usage_date: string;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    const { data, error } = await supabase
      .from('realtime_usage')
      .select('cost_usd, request_count, usage_date')
      .eq('user_id', user.id)
      .eq('usage_date', today)
      .maybeSingle();

    if (error) {
      console.error('[realtime/usage GET] Supabase error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const row = data as UsageRow | null;

    return NextResponse.json({
      costUsd: row ? Number(row.cost_usd) : 0,
      requestCount: row ? row.request_count : 0,
      capUsd: CAP_USD,
      date: today,
    });
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    console.error('[realtime/usage GET] Unexpected error:', details);
    return NextResponse.json({ error: 'Internal server error', details }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const computeSeconds: number =
      typeof body?.computeSeconds === 'number' && body.computeSeconds > 0
        ? body.computeSeconds
        : DEFAULT_COMPUTE_SECONDS;

    const incrementCost = computeSeconds * COST_PER_SECOND;
    const today = new Date().toISOString().slice(0, 10);

    // Fetch current usage to check cap before writing
    const { data: existing, error: fetchError } = await supabase
      .from('realtime_usage')
      .select('cost_usd, request_count')
      .eq('user_id', user.id)
      .eq('usage_date', today)
      .maybeSingle();

    if (fetchError) {
      console.error('[realtime/usage POST] Fetch error:', fetchError.message);
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    const currentCost = existing ? Number((existing as UsageRow).cost_usd) : 0;
    const newCost = currentCost + incrementCost;

    if (newCost > CAP_USD) {
      return NextResponse.json(
        { error: 'cap_exceeded', costUsd: currentCost },
        { status: 403 },
      );
    }

    // Upsert: insert or increment cost + request_count
    const { data: upserted, error: upsertError } = await supabase
      .from('realtime_usage')
      .upsert(
        {
          user_id: user.id,
          usage_date: today,
          cost_usd: newCost,
          request_count: existing ? (existing as UsageRow).request_count + 1 : 1,
        },
        { onConflict: 'user_id,usage_date' },
      )
      .select('cost_usd, request_count')
      .single();

    if (upsertError) {
      console.error('[realtime/usage POST] Upsert error:', upsertError.message);
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    const row = upserted as UsageRow;

    return NextResponse.json({
      costUsd: Number(row.cost_usd),
      requestCount: row.request_count,
    });
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    console.error('[realtime/usage POST] Unexpected error:', details);
    return NextResponse.json({ error: 'Internal server error', details }, { status: 500 });
  }
}
