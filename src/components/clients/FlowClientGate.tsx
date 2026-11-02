'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { assignFlowClient, ClientPickerDialog } from './ClientPickerDialog';

/** Existing workflows must be tagged before their owner resumes work. */
export function FlowClientGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [checkedPath, setCheckedPath] = useState('');
  const [flows, setFlows] = useState<{ id: string; title: string }[]>([]);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/flows/untagged', { signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? 'Could not check flow clients.');
        if (!controller.signal.aborted) {
          setFlows(result.flows); setError(''); setCheckedPath(pathname);
        }
      }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [pathname, retry]);

  // Let administrators reach client management even if the client list needs repair.
  if (pathname.startsWith('/dashboard/admin/clients')) return children;
  if (error) return <div className="p-8 text-sm" style={{ color: 'var(--color-white)' }}>
    <p role="alert">{error}</p><button className="mt-3 underline" onClick={() => { setError(''); setRetry(value => value + 1); }}>Retry</button>
  </div>;
  if (checkedPath !== pathname) return <p role="status" className="p-8 text-sm" style={{ color: 'var(--color-white-muted)' }}>Checking flow clients…</p>;
  const flow = flows[0];
  if (!flow) return children;
  return <ClientPickerDialog key={flow.id} title={`Choose a client for “${flow.title}”`}
    description={`${flows.length} existing flow${flows.length === 1 ? '' : 's'} still ${flows.length === 1 ? 'needs' : 'need'} a client. Assign each flow to continue. Its past and future generation costs will be attributed to that client.`}
    submitLabel={flows.length === 1 ? 'Save and continue' : 'Save and tag next flow'}
    onSubmit={async client => {
      await assignFlowClient(flow.id, client.id);
      setFlows(current => current.filter(item => item.id !== flow.id));
    }} />;
}
