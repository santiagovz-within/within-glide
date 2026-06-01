'use client';

import { useEffect, useState } from 'react';
import { useThemeStore } from '@/lib/stores/themeStore';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { Sun, Moon, LogOut, Copy, Check, RefreshCw, Trash2 } from 'lucide-react';

function FigmaIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 38 57" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <path d="M19 28.5a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0z" fill="currentColor" opacity="0.9"/>
      <path d="M0 47.5A9.5 9.5 0 0 1 9.5 38H19v9.5a9.5 9.5 0 0 1-19 0z" fill="currentColor" opacity="0.6"/>
      <path d="M19 0v19H9.5a9.5 9.5 0 0 1 0-19H19z" fill="currentColor" opacity="0.7"/>
      <path d="M0 19a9.5 9.5 0 0 1 9.5-9.5H19V28.5H9.5A9.5 9.5 0 0 1 0 19z" fill="currentColor" opacity="0.8"/>
      <path d="M19 0h9.5a9.5 9.5 0 0 1 0 19H19V0z" fill="currentColor"/>
    </svg>
  );
}

// ── Figma Integration section ───────────────────────────────────────────────

function FigmaTokenSection() {
  const [configured,    setConfigured]    = useState<boolean | null>(null); // null = loading
  const [prefix,        setPrefix]        = useState<string | null>(null);
  const [newToken,      setNewToken]      = useState<string | null>(null);  // shown once after generate
  const [copied,        setCopied]        = useState(false);
  const [loading,       setLoading]       = useState(false);

  useEffect(() => {
    fetch('/api/figma/token')
      .then(r => r.json())
      .then(d => { setConfigured(d.configured); setPrefix(d.prefix ?? null); })
      .catch(() => setConfigured(false));
  }, []);

  async function handleGenerate() {
    setLoading(true);
    setNewToken(null);
    try {
      const res = await fetch('/api/figma/token', { method: 'POST' });
      if (!res.ok) throw new Error('Failed');
      const d = await res.json();
      setNewToken(d.token);
      setPrefix(d.prefix);
      setConfigured(true);
    } finally {
      setLoading(false);
    }
  }

  async function handleRevoke() {
    if (!confirm('Revoke your Figma link token? The plugin will stop receiving sends until you generate a new one.')) return;
    setLoading(true);
    try {
      await fetch('/api/figma/token', { method: 'DELETE' });
      setConfigured(false);
      setPrefix(null);
      setNewToken(null);
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    if (!newToken) return;
    navigator.clipboard.writeText(newToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const btnBase: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '7px 14px', borderRadius: 8, fontSize: 12,
    fontWeight: 600, cursor: loading ? 'wait' : 'pointer',
    opacity: loading ? 0.6 : 1, transition: 'opacity 0.15s',
    border: 'none',
  };

  return (
    <section className="mb-8">
      <h2
        className="text-sm font-semibold uppercase tracking-wider mb-4"
        style={{ color: 'var(--color-white-muted)' }}
      >
        Figma Integration
      </h2>

      <div
        className="p-4 rounded-xl space-y-4"
        style={{ background: 'var(--color-bg-elevated)', border: 'var(--border-default)' }}
      >
        {/* Header row */}
        <div className="flex items-start gap-3">
          <span style={{ color: 'var(--color-white-muted)', marginTop: 2, flexShrink: 0, display: 'flex' }}>
            <FigmaIcon size={18} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium" style={{ color: 'var(--color-white)' }}>Link Token</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-white-muted)' }}>
              Paste this token into the Figma plugin once to link it to your account.
              The plugin will then auto-receive any GIFs you send from the canvas.
            </p>
          </div>
        </div>

        {/* Status */}
        {configured === null ? (
          <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>Loading…</p>
        ) : configured ? (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
            style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', color: '#4ade80' }}
          >
            <span>●</span>
            <span>Token active — starts with <strong>{prefix}…</strong></span>
          </div>
        ) : (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
            style={{ background: 'rgba(255,255,255,0.04)', border: 'var(--border-default)', color: 'var(--color-white-muted)' }}
          >
            No token generated yet
          </div>
        )}

        {/* Newly generated token — shown once */}
        {newToken && (
          <div
            className="rounded-lg p-3 space-y-2"
            style={{ background: 'var(--color-bg-surface)', border: 'var(--border-default)' }}
          >
            <p className="text-xs font-medium" style={{ color: 'var(--color-white-muted)' }}>
              Copy this token now — it won&apos;t be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code
                className="flex-1 text-xs px-2 py-1.5 rounded overflow-x-auto"
                style={{ background: 'rgba(0,0,0,0.3)', color: 'var(--color-white)', fontFamily: 'monospace', whiteSpace: 'nowrap', display: 'block' }}
              >
                {newToken}
              </code>
              <button
                onClick={handleCopy}
                style={{ ...btnBase, background: copied ? 'rgba(34,197,94,0.15)' : 'var(--color-bg-hover)', color: copied ? '#4ade80' : 'var(--color-white)', padding: '7px 10px' }}
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {!configured ? (
            <button
              onClick={handleGenerate}
              disabled={loading}
              style={{ ...btnBase, background: 'var(--color-accent)', color: '#fff' }}
            >
              <FigmaIcon size={13} />
              Generate Token
            </button>
          ) : (
            <>
              <button
                onClick={handleGenerate}
                disabled={loading}
                style={{ ...btnBase, background: 'var(--color-bg-hover)', color: 'var(--color-white)' }}
              >
                <RefreshCw size={13} />
                Regenerate
              </button>
              <button
                onClick={handleRevoke}
                disabled={loading}
                style={{ ...btnBase, background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }}
              >
                <Trash2 size={13} />
                Revoke
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

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

        {/* Figma Integration */}
        <FigmaTokenSection />

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
