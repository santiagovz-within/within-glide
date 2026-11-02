import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const flows = [];
  for (let from = 0; ; ) {
    const { data, error } = await supabase.from('flows').select('id, title')
      .eq('user_id', user.id).is('client_id', null).order('created_at').order('id').range(from, from + 999);
    if (error) return NextResponse.json({ error: 'Could not check flow clients. Please try again.' }, { status: 500 });
    flows.push(...data);
    if (!data.length) break;
    from += data.length;
  }
  return NextResponse.json({ flows });
}
