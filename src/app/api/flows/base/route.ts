import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

// GET /api/flows/base — returns all is_template=true flows (visible to all users)
export async function GET() {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('flows')
      .select('id, title, description, thumbnail_url, flow_data, created_at, updated_at')
      .eq('is_template', true)
      .order('created_at', { ascending: true });

    if (error) return NextResponse.json({ baseFlows: [] });
    return NextResponse.json({ baseFlows: data ?? [] });
  } catch {
    return NextResponse.json({ baseFlows: [] });
  }
}
