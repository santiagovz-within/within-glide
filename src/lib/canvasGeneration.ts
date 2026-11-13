import type { SupabaseClient } from '@supabase/supabase-js';
import type { Generation } from '@/types';
import { canonicalizeGcsUrl } from '@/lib/utils/mediaUtils';

/** Match the actual output, never the node's latest settings or generation. */
export async function findCanvasGeneration(
  supabase: SupabaseClient,
  mediaUrl: string,
  signal: AbortSignal,
): Promise<Generation | null> {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!user) throw new Error('Sign in to view generation details.');

  const canonicalUrl = canonicalizeGcsUrl(mediaUrl);
  const query = () => supabase.from('generations').select('*')
    .eq('user_id', user.id).eq('status', 'completed')
    .neq('media_type', 'prompt');
  const { data, error } = await query()
    .in('media_url', [...new Set([canonicalUrl, mediaUrl])])
    .order('created_at', { ascending: false }).limit(1).abortSignal(signal).maybeSingle();
  if (error) throw error;
  if (data) return data as Generation;
  if (!canonicalUrl.startsWith('gcs:')) return null;

  // Older records store signed URLs. Their signatures change when a flow is
  // reopened, so compare the exact object path, independent of the signature.
  const path = canonicalUrl.slice(4);
  const paths = [...new Set([path, path.split('/').map(encodeURIComponent).join('/')])];
  const prefixes = paths.flatMap(objectPath => [
    `https://storage.googleapis.com/within-glide/${objectPath}?`,
    `https://within-glide.storage.googleapis.com/${objectPath}?`,
  ]);
  const matches = await Promise.all(prefixes.map(async prefix => {
    const pattern = prefix.replace(/[\\%_]/g, '\\$&') + '%';
    const result = await query().like('media_url', pattern)
      .order('created_at', { ascending: false }).limit(1).abortSignal(signal).maybeSingle();
    if (result.error) throw result.error;
    return result.data as Generation | null;
  }));
  return matches.find(row => row && canonicalizeGcsUrl(row.media_url) === canonicalUrl) ?? null;
}
