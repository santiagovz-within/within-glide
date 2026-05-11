'use client';

import { useThemeStore } from '@/lib/stores/themeStore';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { Sun, Moon, LogOut } from 'lucide-react';

export default function SettingsPage() {
  const { theme, toggleTheme } = useThemeStore();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="h-full overflow-auto p-8">
      <div className="max-w-lg">
        <h1 className="text-2xl font-semibold mb-8" style={{ color: 'var(--color-white)' }}>
          Settings
        </h1>

        {/* Appearance */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--color-white-muted)' }}>
            Appearance
          </h2>
          <div
            className="p-4 rounded-xl flex items-center justify-between"
            style={{ background: 'var(--color-bg-elevated)', border: 'var(--border-default)' }}
          >
            <div className="flex items-center gap-3">
              {theme === 'dark' ? (
                <Moon size={18} style={{ color: 'var(--color-white)' }} />
              ) : (
                <Sun size={18} style={{ color: 'var(--color-white)' }} />
              )}
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--color-white)' }}>
                  {theme === 'dark' ? 'Dark Mode' : 'Light Mode'}
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-white-muted)' }}>
                  {theme === 'dark' ? 'Using dark theme' : 'Using light theme'}
                </p>
              </div>
            </div>

            {/* Toggle */}
            <button
              onClick={toggleTheme}
              className="relative w-12 h-6 rounded-full transition-colors duration-200"
              style={{ background: theme === 'dark' ? 'var(--color-accent)' : 'var(--color-bg-hover)' }}
            >
              <span
                className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform duration-200 shadow-sm"
                style={{ transform: theme === 'dark' ? 'translateX(24px)' : 'translateX(0)' }}
              />
            </button>
          </div>
        </section>

        {/* Account */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--color-white-muted)' }}>
            Account
          </h2>
          <div
            className="p-4 rounded-xl space-y-3"
            style={{ background: 'var(--color-bg-elevated)', border: 'var(--border-default)' }}
          >
            <div>
              <p className="text-xs font-medium mb-1" style={{ color: 'var(--color-white-muted)' }}>Email</p>
              <p className="text-sm" style={{ color: 'var(--color-white)' }}>creative@flowcanvas.app</p>
            </div>
            <div>
              <p className="text-xs font-medium mb-1" style={{ color: 'var(--color-white-muted)' }}>Username</p>
              <p className="text-sm" style={{ color: 'var(--color-white)' }}>creative</p>
            </div>
          </div>
        </section>

        {/* Sign out */}
        <section>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors hover:opacity-80"
            style={{
              color: 'var(--color-error)',
              border: '1px solid var(--color-error)',
            }}
          >
            <LogOut size={16} />
            Sign Out
          </button>
        </section>
      </div>
    </div>
  );
}
