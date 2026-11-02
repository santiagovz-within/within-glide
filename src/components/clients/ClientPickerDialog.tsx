'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { Client } from '@/types';

export async function assignFlowClient(flowId: string, clientId: string) {
  const response = await fetch(`/api/flows/${flowId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Could not assign the client.');
}

export function ClientPickerDialog({ title, description, submitLabel = 'Save client', initialClientId = '', onSubmit, onCancel }: {
  title: string;
  description: string;
  submitLabel?: string;
  initialClientId?: string;
  onSubmit: (client: Client) => Promise<void>;
  onCancel?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [clients, setClients] = useState<Client[] | null>(null);
  const [selectedId, setSelectedId] = useState(initialClientId);
  const [search, setSearch] = useState('');
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  const submitting = useRef(false);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/clients', { signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? 'Could not load clients.');
        setClients(result.clients);
      })
      .catch(error => { if (!controller.signal.aborted) setLoadError(error.message); });
    return () => controller.abort();
  }, [retry]);

  const selected = clients?.find(client => client.id === selectedId);
  const filtered = clients?.filter(client => client.id === selectedId || client.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
      onCancel={event => { event.preventDefault(); if (!saving) onCancel?.(); }}
      className="m-auto w-[min(440px,calc(100vw-32px))] rounded-2xl p-6 shadow-2xl backdrop:bg-black/70"
      style={{ background: 'var(--color-bg-elevated)', color: 'var(--color-white)', border: 'var(--border-default)' }}>
      <form onSubmit={async event => {
        event.preventDefault();
        if (!selected || submitting.current) return;
        submitting.current = true;
        setSaving(true);
        setSaveError('');
        try { await onSubmit(selected); }
        catch (error) { setSaveError(error instanceof Error ? error.message : 'Could not save client.'); }
        finally { submitting.current = false; setSaving(false); }
      }}>
        <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-accent)' }}>Client required</p>
        <h2 id={titleId} className="text-xl font-semibold break-words">{title}</h2>
        <p id={descriptionId} className="mt-2 mb-5 text-sm" style={{ color: 'var(--color-white-muted)' }}>{description}</p>
        {loadError ? (
          <div className="text-sm"><p role="alert">{loadError}</p>
            <button type="button" className="underline mt-2" onClick={() => { setLoadError(''); setRetry(value => value + 1); }}>Retry loading clients</button>
          </div>
        ) : !clients ? <p role="status" className="text-sm">Loading clients…</p> : clients.length === 0 ? (
          <p role="alert" className="text-sm">No clients available. An administrator needs to add a client.</p>
        ) : (
          <div className="space-y-3">
            <input aria-label="Search clients" placeholder="Search clients…" value={search} onChange={event => setSearch(event.target.value)}
              disabled={saving} className="w-full rounded-lg px-3 py-2.5 text-sm"
              style={{ background: 'var(--color-bg-surface)', border: 'var(--border-default)' }} />
            <label className="block text-sm font-medium">Client
              <select required value={selectedId} onChange={event => setSelectedId(event.target.value)} disabled={saving}
                className="mt-1.5 w-full rounded-lg px-3 py-2.5 text-sm"
                style={{ background: 'var(--color-bg-surface)', color: 'var(--color-white)', border: 'var(--border-default)' }}>
                <option value="" disabled>Choose a client</option>
                {filtered?.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            </label>
            {filtered?.length === 0 && <p className="text-xs">No matching clients.</p>}
          </div>
        )}
        {saveError && <p role="alert" className="text-sm mt-3" style={{ color: 'var(--color-error)' }}>{saveError}</p>}
        <div className="flex justify-end gap-2 mt-6">
          {onCancel && <button type="button" onClick={onCancel} disabled={saving} className="px-4 py-2 rounded-lg text-sm disabled:opacity-50">Cancel</button>}
          <button type="submit" disabled={!selected || saving} className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40"
            style={{ background: 'var(--color-accent)', color: '#fff' }}>{saving ? 'Saving…' : submitLabel}</button>
        </div>
      </form>
    </dialog>
  );
}
