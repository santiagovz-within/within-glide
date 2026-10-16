import type { createClient } from '@/lib/supabase/server';
import { isHistoricalGeneration } from '@/lib/generationRecoveryPolicy';

type Client = Awaited<ReturnType<typeof createClient>>;
export interface RecoverableGeneration {
  id: string;
  status: string;
  created_at: string;
  parameters: Record<string, unknown> | null;
}

const RECENT_CONFIRMATION_MS = 24 * 60 * 60 * 1000;
const CONFIRMATION_WRITE_INTERVAL_MS = 60 * 60 * 1000;
const RECOVERY_ERROR = 'Recovery expired: this generation is over 30 days old and its status or result could not be recovered. Please generate again.';

function lastConfirmedAt(generation: RecoverableGeneration): number {
  const value = generation.parameters?.falLastConfirmedActiveAt;
  return typeof value === 'string' ? Date.parse(value) : NaN;
}

function unchangedGeneration(client: Client, userId: string, generation: RecoverableGeneration,
  updates: Record<string, unknown>) {
  const query = client.from('generations').update(updates)
    .eq('id', generation.id).eq('user_id', userId).eq('status', 'processing');
  // A concurrent successful poll or completion wins over this stale snapshot.
  return generation.parameters === null
    ? query.is('parameters', null)
    : query.eq('parameters', JSON.stringify(generation.parameters));
}

/** Remember live provider evidence across reloads and tabs, at most hourly. */
export async function rememberActiveGeneration(client: Client, userId: string, generation: RecoverableGeneration) {
  if (Date.now() - lastConfirmedAt(generation) < CONFIRMATION_WRITE_INTERVAL_MS) return;
  const { error } = await unchangedGeneration(client, userId, generation, {
    parameters: { ...generation.parameters, falLastConfirmedActiveAt: new Date().toISOString() },
  });
  if (error) console.error('[fal/recovery] Could not save active confirmation:', error.message);
}

/** Call only after trying fal, never because a queued/running job is old. */
export async function expireUnverifiedGeneration(client: Client, userId: string, generation: RecoverableGeneration) {
  if (generation.status !== 'processing' || !isHistoricalGeneration(Date.parse(generation.created_at))
    || Date.now() - lastConfirmedAt(generation) < RECENT_CONFIRMATION_MS) return null;
  const { data, error } = await unchangedGeneration(client, userId, generation, {
    status: 'failed', error_message: RECOVERY_ERROR,
    parameters: { ...generation.parameters, recoveryExpiredAt: new Date().toISOString() },
  }).select('id');
  if (error) throw new Error('Could not persist expired generation recovery');
  return data?.length ? RECOVERY_ERROR : null;
}
