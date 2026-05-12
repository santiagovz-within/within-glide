'use client';

import { useEffect, useState, useCallback } from 'react';
import { Users, Plus, Trash2, Shield, ShieldOff, Loader2 } from 'lucide-react';

interface AdminUser {
  id: string;
  email: string | undefined;
  last_sign_in_at: string | null;
  created_at: string;
  profile: {
    id: string;
    username: string;
    display_name: string | null;
    is_admin: boolean;
    created_at: string;
  } | null;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const loadUsers = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/admin/users');
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  async function handleCreate() {
    if (!newEmail.trim() || !newPassword.trim()) return;
    setCreating(true);
    setError('');
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: newEmail.trim(), password: newPassword, display_name: newDisplayName.trim(), is_admin: newIsAdmin }),
    });
    if (res.ok) {
      setNewEmail(''); setNewPassword(''); setNewDisplayName(''); setNewIsAdmin(false);
      setShowCreate(false);
      await loadUsers();
    } else {
      const d = await res.json();
      setError(d.error ?? 'Failed to create user');
    }
    setCreating(false);
  }

  async function handleToggleAdmin(userId: string, currentIsAdmin: boolean) {
    await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_admin: !currentIsAdmin }),
    });
    setUsers(users.map((u) =>
      u.id === userId && u.profile
        ? { ...u, profile: { ...u.profile, is_admin: !currentIsAdmin } }
        : u
    ));
  }

  async function handleDelete(userId: string, email: string | undefined) {
    if (!confirm(`Delete user ${email ?? userId}? This cannot be undone.`)) return;
    const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
    if (res.ok) {
      setUsers(users.filter((u) => u.id !== userId));
    }
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--color-bg-surface)',
    border: 'var(--border-default)',
    color: 'var(--color-white)',
    borderRadius: 8,
    padding: '8px 12px',
    fontSize: 13,
    outline: 'none',
    width: '100%',
  };

  return (
    <div className="h-full overflow-auto p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Users size={24} style={{ color: 'var(--color-accent)' }} />
          <div>
            <h1 className="text-xl font-semibold" style={{ color: 'var(--color-white)' }}>User Management</h1>
            <p className="text-sm" style={{ color: 'var(--color-white-muted)' }}>
              Create, modify and remove Canvas Flow users
            </p>
          </div>
        </div>
        <button
          onClick={() => { setShowCreate(true); setError(''); }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-80"
          style={{ background: '#fff', color: '#000' }}
        >
          <Plus size={14} />
          New User
        </button>
      </div>

      {/* Create user form */}
      {showCreate && (
        <div
          className="mb-6 rounded-xl p-5 space-y-3"
          style={{ background: 'var(--color-bg-elevated)', border: 'var(--border-default)' }}
        >
          <p className="text-sm font-semibold" style={{ color: 'var(--color-white)' }}>Create New User</p>
          <div className="grid grid-cols-2 gap-3">
            <input
              type="email"
              placeholder="Email address"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              style={inputStyle}
            />
            <input
              type="password"
              placeholder="Password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              style={inputStyle}
            />
            <input
              type="text"
              placeholder="Display name (optional)"
              value={newDisplayName}
              onChange={(e) => setNewDisplayName(e.target.value)}
              style={inputStyle}
            />
            <label className="flex items-center gap-2 px-3 cursor-pointer" style={{ color: 'var(--color-white-muted)', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={newIsAdmin}
                onChange={(e) => setNewIsAdmin(e.target.checked)}
                className="accent-blue-500"
              />
              Grant admin privileges
            </label>
          </div>
          {error && <p className="text-xs" style={{ color: 'var(--color-error)' }}>{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={creating || !newEmail.trim() || !newPassword.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-opacity disabled:opacity-40"
              style={{ background: '#fff', color: '#000' }}
            >
              {creating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              {creating ? 'Creating…' : 'Create User'}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 rounded-lg text-sm transition-colors hover:bg-white/5"
              style={{ color: 'var(--color-white-muted)', border: 'var(--border-default)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Users table */}
      {loading ? (
        <div className="flex items-center gap-2" style={{ color: 'var(--color-white-muted)' }}>
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Loading users…</span>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: 'var(--border-default)' }}>
          {/* Table header */}
          <div
            className="grid grid-cols-[1fr_1fr_120px_80px] px-4 py-3 text-xs font-semibold uppercase tracking-wider"
            style={{ background: 'var(--color-bg-surface)', color: 'var(--color-white-muted)', borderBottom: 'var(--border-default)' }}
          >
            <span>User</span>
            <span>Email</span>
            <span>Role</span>
            <span className="text-right">Actions</span>
          </div>

          {users.map((user) => (
            <div
              key={user.id}
              className="grid grid-cols-[1fr_1fr_120px_80px] items-center px-4 py-3 transition-colors hover:bg-white/[0.03]"
              style={{ background: 'var(--color-bg-elevated)', borderBottom: 'var(--border-default)' }}
            >
              {/* Name + joined */}
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--color-white)' }}>
                  {user.profile?.display_name ?? user.profile?.username ?? '—'}
                </p>
                <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>
                  Joined {new Date(user.created_at).toLocaleDateString()}
                </p>
              </div>

              {/* Email */}
              <p className="text-sm" style={{ color: 'var(--color-white-muted)' }}>
                {user.email ?? '—'}
              </p>

              {/* Role badge */}
              <div>
                {user.profile?.is_admin ? (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                    style={{ background: 'rgba(59,158,255,0.15)', color: 'var(--color-accent)' }}
                  >
                    <Shield size={10} />
                    Admin
                  </span>
                ) : (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                    style={{ background: 'var(--color-bg-surface)', color: 'var(--color-white-muted)' }}
                  >
                    User
                  </span>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => handleToggleAdmin(user.id, user.profile?.is_admin ?? false)}
                  title={user.profile?.is_admin ? 'Remove admin' : 'Make admin'}
                  className="p-1.5 rounded-lg transition-colors hover:bg-white/10"
                >
                  {user.profile?.is_admin
                    ? <ShieldOff size={14} style={{ color: 'var(--color-white-muted)' }} />
                    : <Shield size={14} style={{ color: 'var(--color-accent)' }} />
                  }
                </button>
                <button
                  onClick={() => handleDelete(user.id, user.email)}
                  title="Delete user"
                  className="p-1.5 rounded-lg transition-colors hover:bg-red-500/10"
                >
                  <Trash2 size={14} style={{ color: 'var(--color-error)' }} />
                </button>
              </div>
            </div>
          ))}

          {users.length === 0 && (
            <div className="px-4 py-8 text-center text-sm" style={{ color: 'var(--color-white-muted)' }}>
              No users found
            </div>
          )}
        </div>
      )}
    </div>
  );
}
