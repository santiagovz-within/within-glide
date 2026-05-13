'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Users, Plus, Trash2, Shield, ShieldOff, RefreshCw, Edit2, Check, X, AlertTriangle } from 'lucide-react';

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
  const [users, setUsers]                   = useState<AdminUser[]>([]);
  const [loading, setLoading]               = useState(true);
  const [showCreate, setShowCreate]         = useState(false);
  const [newEmail, setNewEmail]             = useState('');
  const [newPassword, setNewPassword]       = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newIsAdmin, setNewIsAdmin]         = useState(false);
  const [creating, setCreating]             = useState(false);
  const [createError, setCreateError]       = useState('');
  const [createWarning, setCreateWarning]   = useState('');

  // Per-row state
  const [togglingId, setTogglingId]         = useState<string | null>(null);
  const [rowErrors, setRowErrors]           = useState<Record<string, string>>({});
  const [editingNameId, setEditingNameId]   = useState<string | null>(null);
  const [editingNameValue, setEditingNameValue] = useState('');
  const [savingNameId, setSavingNameId]     = useState<string | null>(null);
  const nameInputRef                        = useRef<HTMLInputElement>(null);

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

  // Focus name input when entering edit mode
  useEffect(() => {
    if (editingNameId) nameInputRef.current?.focus();
  }, [editingNameId]);

  function startEditName(user: AdminUser) {
    setEditingNameId(user.id);
    setEditingNameValue(user.profile?.display_name ?? user.profile?.username ?? '');
  }

  async function saveName(userId: string) {
    setSavingNameId(userId);
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: editingNameValue.trim() }),
    });
    if (res.ok) {
      setUsers(users.map((u) =>
        u.id === userId && u.profile
          ? { ...u, profile: { ...u.profile, display_name: editingNameValue.trim() || null } }
          : u
      ));
      setEditingNameId(null);
    } else {
      const d = await res.json().catch(() => ({}));
      setRowErrors((prev) => ({ ...prev, [userId]: d.error ?? 'Failed to save name' }));
    }
    setSavingNameId(null);
  }

  function cancelEditName() {
    setEditingNameId(null);
    setEditingNameValue('');
  }

  async function handleCreate() {
    if (!newEmail.trim() || !newPassword.trim()) return;
    setCreating(true);
    setCreateError('');
    setCreateWarning('');
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: newEmail.trim(),
        password: newPassword,
        display_name: newDisplayName.trim(),
        is_admin: newIsAdmin,
      }),
    });
    const d = await res.json();
    if (res.ok || res.status === 207) {
      setNewEmail(''); setNewPassword(''); setNewDisplayName(''); setNewIsAdmin(false);
      if (res.status === 207 && d.warning) {
        setCreateWarning(d.warning);
      } else {
        setShowCreate(false);
      }
      await loadUsers();
    } else {
      setCreateError(d.error ?? 'Failed to create user');
    }
    setCreating(false);
  }

  async function handleToggleAdmin(userId: string, currentIsAdmin: boolean) {
    setTogglingId(userId);
    setRowErrors((prev) => { const n = { ...prev }; delete n[userId]; return n; });

    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_admin: !currentIsAdmin }),
    });

    if (res.ok) {
      setUsers(users.map((u) =>
        u.id === userId && u.profile
          ? { ...u, profile: { ...u.profile, is_admin: !currentIsAdmin } }
          : u
      ));
    } else {
      const d = await res.json().catch(() => ({}));
      setRowErrors((prev) => ({
        ...prev,
        [userId]: d.error ?? 'Failed to update role — run the SQL migration first if is_admin column is missing',
      }));
    }
    setTogglingId(null);
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
              Create, modify and remove WITHIN Glide users
            </p>
          </div>
        </div>
        <button
          onClick={() => { setShowCreate(true); setCreateError(''); setCreateWarning(''); }}
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

          {createError && (
            <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--color-error)' }}>
              <AlertTriangle size={12} /> {createError}
            </p>
          )}
          {createWarning && (
            <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--color-warning)' }}>
              <AlertTriangle size={12} /> {createWarning}
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={creating || !newEmail.trim() || !newPassword.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-opacity disabled:opacity-40"
              style={{ background: '#fff', color: '#000' }}
            >
              {creating ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />}
              {creating ? 'Creating…' : 'Create User'}
            </button>
            <button
              onClick={() => { setShowCreate(false); setCreateWarning(''); setCreateError(''); }}
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
          <RefreshCw size={16} className="animate-spin" />
          <span className="text-sm">Loading users…</span>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: 'var(--border-default)' }}>
          {/* Table header */}
          <div
            className="grid grid-cols-[1fr_1fr_120px_80px] px-4 py-3 text-xs font-semibold uppercase tracking-wider"
            style={{ background: 'var(--color-bg-surface)', color: 'var(--color-white-muted)', borderBottom: 'var(--border-default)' }}
          >
            <span>Name</span>
            <span>Email</span>
            <span>Role</span>
            <span className="text-right">Actions</span>
          </div>

          {users.map((user) => {
            const isEditingName = editingNameId === user.id;
            const isSavingName  = savingNameId  === user.id;
            const isToggling    = togglingId    === user.id;
            const rowError      = rowErrors[user.id];

            return (
              <div key={user.id} style={{ background: 'var(--color-bg-elevated)', borderBottom: 'var(--border-default)' }}>
                <div className="grid grid-cols-[1fr_1fr_120px_80px] items-center px-4 py-3 transition-colors hover:bg-white/[0.03] group">
                  {/* Editable name */}
                  <div className="flex items-center gap-1.5 min-w-0">
                    {isEditingName ? (
                      <>
                        <input
                          ref={nameInputRef}
                          type="text"
                          value={editingNameValue}
                          onChange={(e) => setEditingNameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveName(user.id);
                            if (e.key === 'Escape') cancelEditName();
                          }}
                          className="flex-1 min-w-0 text-sm outline-none rounded px-1.5 py-0.5"
                          style={{
                            background: 'var(--color-bg-surface)',
                            border: '1px solid var(--color-accent)',
                            color: 'var(--color-white)',
                          }}
                        />
                        <button
                          onClick={() => saveName(user.id)}
                          disabled={isSavingName}
                          className="p-0.5 rounded transition-colors hover:bg-white/10 disabled:opacity-40 shrink-0"
                          title="Save name"
                        >
                          {isSavingName
                            ? <RefreshCw size={12} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
                            : <Check size={12} style={{ color: 'var(--color-success)' }} />
                          }
                        </button>
                        <button
                          onClick={cancelEditName}
                          className="p-0.5 rounded transition-colors hover:bg-white/10 shrink-0"
                          title="Cancel"
                        >
                          <X size={12} style={{ color: 'var(--color-white-muted)' }} />
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate" style={{ color: 'var(--color-white)' }}>
                            {user.profile?.display_name ?? user.profile?.username ?? '—'}
                          </p>
                          <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>
                            Joined {new Date(user.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <button
                          onClick={() => startEditName(user)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-white/10 shrink-0 ml-1"
                          title="Edit name"
                        >
                          <Edit2 size={11} style={{ color: 'var(--color-white-muted)' }} />
                        </button>
                      </>
                    )}
                  </div>

                  {/* Email — read-only */}
                  <p className="text-sm truncate pr-2" style={{ color: 'var(--color-white-muted)' }}>
                    {user.email ?? '—'}
                  </p>

                  {/* Role badge */}
                  <div>
                    {user.profile?.is_admin ? (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{ background: 'rgba(59,158,255,0.15)', color: 'var(--color-accent)' }}
                      >
                        <Shield size={10} /> Admin
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
                      disabled={isToggling}
                      title={user.profile?.is_admin ? 'Remove admin' : 'Make admin'}
                      className="p-1.5 rounded-lg transition-colors hover:bg-white/10 disabled:opacity-40"
                    >
                      {isToggling
                        ? <RefreshCw size={14} className="animate-spin" style={{ color: 'var(--color-white-muted)' }} />
                        : user.profile?.is_admin
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

                {/* Inline row error */}
                {rowError && (
                  <div className="px-4 pb-2 flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-error)' }}>
                    <AlertTriangle size={11} />
                    {rowError}
                    <button
                      className="ml-auto underline opacity-70 hover:opacity-100"
                      onClick={() => setRowErrors((prev) => { const n = { ...prev }; delete n[user.id]; return n; })}
                    >
                      dismiss
                    </button>
                  </div>
                )}
              </div>
            );
          })}

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
