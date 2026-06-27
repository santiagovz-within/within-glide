'use client';

import { useEffect, useRef, useState } from 'react';
import { useThemeStore } from '@/lib/stores/themeStore';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { Sun, Moon, LogOut, Copy, Check, RefreshCw, Trash2, ImagePlus, X, Save, Volume2, VolumeX } from 'lucide-react';

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

// ── Login Background section (admins only) ──────────────────────────────────

function LoginBackgroundSection() {
  const [isAdmin,    setIsAdmin]    = useState<boolean | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [uploading,  setUploading]  = useState(false);
  const [status,     setStatus]     = useState<'idle' | 'success' | 'error'>('idle');
  const [statusMsg,  setStatusMsg]  = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data: profile } = await supabase
        .from('profiles').select('is_admin').eq('id', user.id).single();
      if (!profile?.is_admin) { setIsAdmin(false); return; }
      setIsAdmin(true);
      // Load current image preview
      fetch('/api/settings/login-image')
        .then(r => r.json())
        .then(d => setCurrentUrl(d.url ?? null))
        .catch(() => {});
    });
  }, []);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setStatus('idle');

    try {
      // 1. Get signed write URL from server
      const stageRes = await fetch('/api/admin/settings/login-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: file.type || 'image/jpeg' }),
      });
      if (!stageRes.ok) throw new Error('Could not get upload URL');
      const { uploadUrl, gcsRef, contentType } = await stageRes.json();

      // 2. PUT file directly to GCS using the exact contentType the URL was signed for
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': contentType },
      });
      if (!putRes.ok) throw new Error(`GCS upload failed (${putRes.status})`);

      // 3. Confirm the gcsRef
      const saveRes = await fetch('/api/admin/settings/login-image', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gcsRef }),
      });
      if (!saveRes.ok) throw new Error('Could not save image reference');

      // 4. Refresh preview
      const urlRes = await fetch('/api/settings/login-image');
      const urlData = await urlRes.json();
      setCurrentUrl(urlData.url ?? null);
      setStatus('success');
      setStatusMsg('Login background updated.');
    } catch (err) {
      setStatus('error');
      setStatusMsg(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleRemove() {
    if (!confirm('Remove the login background image?')) return;
    setUploading(true);
    try {
      await fetch('/api/admin/settings/login-image', { method: 'DELETE' });
      setCurrentUrl(null);
      setStatus('success');
      setStatusMsg('Login background removed.');
    } catch {
      setStatus('error');
      setStatusMsg('Failed to remove image.');
    } finally {
      setUploading(false);
    }
  }

  if (isAdmin === null || isAdmin === false) return null;

  const btnBase: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '7px 14px', borderRadius: 8, fontSize: 12,
    fontWeight: 600, cursor: uploading ? 'wait' : 'pointer',
    opacity: uploading ? 0.6 : 1, border: 'none',
  };

  return (
    <section className="mb-8">
      <h2
        className="text-sm font-semibold uppercase tracking-wider mb-4"
        style={{ color: 'var(--color-white-muted)' }}
      >
        Login Page
      </h2>
      <div
        className="p-4 rounded-xl space-y-4"
        style={{ background: 'var(--color-bg-elevated)', border: 'var(--border-default)' }}
      >
        <div className="flex items-start gap-3">
          <span style={{ color: 'var(--color-white-muted)', marginTop: 2, flexShrink: 0 }}>
            <ImagePlus size={18} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium" style={{ color: 'var(--color-white)' }}>Background Image</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-white-muted)' }}>
              Shown on the right side of the login page. Recommended: tall portrait image (e.g. 1080×1920).
            </p>
          </div>
        </div>

        {/* Current image preview */}
        {currentUrl && (
          <div className="relative rounded-xl overflow-hidden" style={{ aspectRatio: '16/9' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={currentUrl} alt="Login background" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <button
              onClick={handleRemove}
              disabled={uploading}
              className="absolute top-2 right-2 p-1 rounded-lg transition-opacity hover:opacity-80"
              style={{ background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', cursor: 'pointer' }}
              title="Remove image"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {status !== 'idle' && (
          <p
            className="text-xs"
            style={{ color: status === 'success' ? 'var(--color-success)' : 'var(--color-error)' }}
          >
            {statusMsg}
          </p>
        )}

        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            style={{ ...btnBase, background: 'var(--color-accent)', color: '#fff' }}
          >
            {uploading
              ? <RefreshCw size={13} className="animate-spin" />
              : <ImagePlus size={13} />
            }
            {uploading ? 'Uploading…' : currentUrl ? 'Replace Image' : 'Upload Image'}
          </button>
        </div>
      </div>
    </section>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { theme, toggleTheme, soundEnabled, toggleSound } = useThemeStore();
  const router = useRouter();

  const [email,         setEmail]         = useState('');
  const [username,      setUsername]      = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [saving,        setSaving]        = useState(false);
  const [saveStatus,    setSaveStatus]    = useState<'idle' | 'success' | 'error'>('idle');
  const [saveMsg,       setSaveMsg]       = useState('');

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      setEmail(user.email ?? '');
      const { data: profile } = await supabase
        .from('profiles')
        .select('username, display_name')
        .eq('id', user.id)
        .single();
      const name = profile?.display_name ?? profile?.username ?? '';
      setUsername(name);
      setUsernameInput(name);
      setProfileLoaded(true);
    });
  }, []);

  async function handleSaveUsername() {
    const trimmed = usernameInput.trim();
    if (!trimmed || trimmed === username) return;
    setSaving(true);
    setSaveStatus('idle');
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('profiles')
        .update({ username: trimmed, display_name: trimmed })
        .eq('id', user.id);
      if (error) throw error;
      setUsername(trimmed);
      setSaveStatus('success');
      setSaveMsg('Username updated.');
    } catch (err) {
      setSaveStatus('error');
      setSaveMsg(err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  }

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

        {/* Appearance and UI */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--color-white-muted)' }}>
            Appearance and UI
          </h2>
          <div
            className="rounded-xl divide-y"
            style={{ background: 'var(--color-bg-elevated)', border: 'var(--border-default)', divideColor: 'var(--color-bg-hover)' }}
          >
            {/* Theme toggle */}
            <div className="p-4 flex items-center justify-between">
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

            {/* Sound notifications toggle */}
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {soundEnabled ? (
                  <Volume2 size={18} style={{ color: 'var(--color-white)' }} />
                ) : (
                  <VolumeX size={18} style={{ color: 'var(--color-white-muted)' }} />
                )}
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--color-white)' }}>
                    Sound Notifications
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-white-muted)' }}>
                    {soundEnabled ? 'Play a sound when a generation completes' : 'Sound notifications are off'}
                  </p>
                </div>
              </div>
              <button
                onClick={toggleSound}
                className="relative w-12 h-6 rounded-full transition-colors duration-200"
                style={{ background: soundEnabled ? 'var(--color-accent)' : 'var(--color-bg-hover)' }}
              >
                <span
                  className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform duration-200 shadow-sm"
                  style={{ transform: soundEnabled ? 'translateX(24px)' : 'translateX(0)' }}
                />
              </button>
            </div>
          </div>
        </section>

        {/* Account */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--color-white-muted)' }}>
            Account
          </h2>
          <div
            className="p-4 rounded-xl space-y-4"
            style={{ background: 'var(--color-bg-elevated)', border: 'var(--border-default)' }}
          >
            {/* Email — read-only */}
            <div>
              <p className="text-xs font-medium mb-1" style={{ color: 'var(--color-white-muted)' }}>Email</p>
              {profileLoaded ? (
                <p className="text-sm" style={{ color: 'var(--color-white)' }}>{email}</p>
              ) : (
                <div className="h-5 w-48 rounded animate-pulse" style={{ background: 'var(--color-bg-surface)' }} />
              )}
            </div>

            {/* Username — editable */}
            <div>
              <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--color-white-muted)' }}>Username</p>
              {profileLoaded ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={usernameInput}
                    onChange={e => { setUsernameInput(e.target.value); setSaveStatus('idle'); }}
                    onKeyDown={e => e.key === 'Enter' && handleSaveUsername()}
                    className="flex-1 text-sm px-3 py-1.5 rounded-lg outline-none"
                    style={{
                      background: 'var(--color-bg-surface)',
                      border: 'var(--border-default)',
                      color: 'var(--color-white)',
                    }}
                    placeholder="Your username"
                  />
                  <button
                    onClick={handleSaveUsername}
                    disabled={saving || !usernameInput.trim() || usernameInput.trim() === username}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity disabled:opacity-40"
                    style={{ background: 'var(--color-accent)', color: '#fff', border: 'none', cursor: 'pointer' }}
                  >
                    {saving ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
                    Save
                  </button>
                </div>
              ) : (
                <div className="h-8 w-full rounded-lg animate-pulse" style={{ background: 'var(--color-bg-surface)' }} />
              )}
              {saveStatus !== 'idle' && (
                <p
                  className="text-xs mt-1.5"
                  style={{ color: saveStatus === 'success' ? 'var(--color-success)' : 'var(--color-error)' }}
                >
                  {saveMsg}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Figma Integration */}
        <FigmaTokenSection />

        {/* Login Background (admins only) */}
        <LoginBackgroundSection />

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
