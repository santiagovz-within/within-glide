import type { SupabaseClient } from '@supabase/supabase-js';

export class FlowClientError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function isClientId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function validateClient(client: SupabaseClient, clientId: unknown): Promise<string> {
  if (!isClientId(clientId)) throw new FlowClientError('Choose a client for this flow.');
  const { data, error } = await client.from('clients').select('id').eq('id', clientId).maybeSingle();
  if (error) throw new FlowClientError('Could not verify the client. Please try again.', 503);
  if (!data) throw new FlowClientError('This client is unavailable. Choose another client.');
  return data.id;
}

/** Check before any paid provider call, including requests from older tabs. */
export async function requireGenerationClient(client: SupabaseClient, userId: string, input: {
  sourceType?: unknown; sourceId?: unknown;
}): Promise<string | null> {
  if (input.sourceType === 'chat') {
    // A canvas ID cannot be disguised as a chat request to skip client checks.
    if (input.sourceId) {
      if (!isClientId(input.sourceId)) throw new FlowClientError('Invalid chat session.');
      const { data, error } = await client.from('chat_sessions').select('id')
        .eq('id', input.sourceId).eq('user_id', userId).maybeSingle();
      if (error) throw new FlowClientError('Could not verify the chat session.', 503);
      if (!data) throw new FlowClientError('Chat session not found.', 404);
    }
    return null;
  }
  if (input.sourceType !== 'canvas' || !isClientId(input.sourceId)) {
    throw new FlowClientError('A flow and client are required for canvas generation.');
  }
  const { data, error } = await client.from('flows').select('client_id')
    .eq('id', input.sourceId).eq('user_id', userId).maybeSingle();
  if (error) throw new FlowClientError('Could not verify the flow client. Please try again.', 503);
  if (!data) throw new FlowClientError('Flow not found.', 404);
  if (!data.client_id) throw new FlowClientError('Choose a client for this flow before generating.', 409);
  return data.client_id;
}
