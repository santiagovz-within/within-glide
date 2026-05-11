import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Sidebar } from '@/components/layout/Sidebar';
import { ThemeProvider } from '@/components/layout/ThemeProvider';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <ThemeProvider>
      <div className="flex h-screen overflow-hidden" style={{ background: 'var(--color-bg-darkest)' }}>
        <Sidebar />
        <main className="flex-1 overflow-hidden min-w-0">
          {children}
        </main>
      </div>
    </ThemeProvider>
  );
}
