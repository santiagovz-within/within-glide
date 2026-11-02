'use client';

import { useEffect, useState } from 'react';
import { Building2, Pencil, Plus } from 'lucide-react';
import type { Client } from '@/types';

export function ClientManagement() {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Client | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loadingError, setLoadingError] = useState('');
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/clients', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Could not load clients.');
      const result = await response.json();
      if (!controller.signal.aborted) setClients(result.clients);
    }).catch(error => { if (!controller.signal.aborted) setLoadingError(error.message); });
    return () => controller.abort();
  }, [retry]);

  return <div className="h-full overflow-auto p-6 md:p-10" style={{ color: 'var(--color-white)' }}>
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-3"><Building2 size={24} /><h1 className="text-2xl font-semibold">Clients</h1></div>
      <p className="mt-2 mb-8 text-sm" style={{ color: 'var(--color-white-muted)' }}>Manage the clients available to every flow. Renaming a client updates its name across flows and spending reports.</p>
      <form className="rounded-xl p-5 mb-6" style={{ background: 'var(--color-bg-elevated)', border: 'var(--border-default)' }}
        onSubmit={async event => {
          event.preventDefault(); if (saving || !name.trim()) return;
          setSaving(true); setError('');
          try {
            const response = await fetch('/api/clients', { method: editing ? 'PATCH' : 'POST',
              headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editing?.id, name }) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error ?? 'Could not save client.');
            setClients(current => [...(current ?? []).filter(client => client.id !== result.client.id), result.client].sort((a, b) => a.name.localeCompare(b.name)));
            setName(''); setEditing(null);
          } catch (error) { setError(error instanceof Error ? error.message : 'Could not save client.'); }
          finally { setSaving(false); }
        }}>
        <label className="block text-sm font-medium" htmlFor="client-name">{editing ? `Edit ${editing.name}` : 'Add client'}</label>
        <div className="flex flex-wrap gap-3 mt-2">
          <input id="client-name" required maxLength={120} value={name} onChange={event => setName(event.target.value)} disabled={saving || !clients}
            placeholder="Client name" className="flex-1 min-w-48 rounded-lg px-3 py-2 text-sm"
            style={{ background: 'var(--color-bg-surface)', border: 'var(--border-default)' }} />
          <button disabled={saving || !name.trim() || !clients} className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40"
            style={{ background: 'var(--color-accent)', color: '#fff' }}><Plus size={14} />{saving ? 'Saving…' : editing ? 'Save changes' : 'Add client'}</button>
          {editing && <button type="button" disabled={saving} onClick={() => { setEditing(null); setName(''); setError(''); }} className="text-sm px-2">Cancel</button>}
        </div>
        {error && <p role="alert" className="text-sm mt-3" style={{ color: 'var(--color-error)' }}>{error}</p>}
      </form>
      <div className="flex items-center justify-between gap-4 mb-4">
        <p className="text-sm">{clients?.length ?? '…'} clients</p>
        <input aria-label="Search clients" placeholder="Search clients…" value={search} onChange={event => setSearch(event.target.value)}
          className="rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--color-bg-elevated)', border: 'var(--border-default)' }} />
      </div>
      {loadingError ? <div role="alert">{loadingError} <button className="underline" onClick={() => { setLoadingError(''); setRetry(value => value + 1); }}>Retry</button></div>
        : !clients ? <p role="status">Loading clients…</p> : <ul className="rounded-xl overflow-hidden" style={{ border: 'var(--border-default)' }}>
          {clients.filter(client => client.name.toLowerCase().includes(search.toLowerCase())).map(client => <li key={client.id}
            className="flex justify-between items-center px-5 py-3" style={{ background: 'var(--color-bg-elevated)', borderBottom: 'var(--border-default)' }}>
            <span className="text-sm">{client.name}</span>
            <button disabled={saving} aria-label={`Edit ${client.name}`} onClick={() => { setEditing(client); setName(client.name); setError(''); document.getElementById('client-name')?.focus(); }}
              className="p-2 rounded-lg hover:bg-white/10"><Pencil size={14} /></button>
          </li>)}
        </ul>}
    </div>
  </div>;
}
