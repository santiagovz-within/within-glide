import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ClientManagement } from './ClientManagement';

export default async function ClientsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single();
  if (!profile?.is_admin) redirect('/dashboard');
  return <ClientManagement />;
}
