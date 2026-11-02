'use client';

import type { Client, Flow } from '@/types';
import { assignFlowClient, ClientPickerDialog } from './ClientPickerDialog';

/** Ask only about the flow being opened, without blocking the dashboard. */
export function FlowClientGate({ flow, isOwner, onClientAssigned, onCancel, children }: {
  flow: Flow | null;
  isOwner: boolean;
  onClientAssigned: (client: Client) => void;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  if (!flow) return <p role="status" className="p-8 text-sm" style={{ color: 'var(--color-white-muted)' }}>Loading flow…</p>;
  if (!isOwner || flow.client_id) return children;

  return <ClientPickerDialog key={flow.id} title={`Choose a client for “${flow.title}”`}
    description="Choose a client to open this flow. Its past and future generation costs will be attributed to that client."
    submitLabel="Save and open flow" onCancel={onCancel}
    onSubmit={async client => {
      await assignFlowClient(flow.id, client.id);
      onClientAssigned(client);
    }} />;
}
