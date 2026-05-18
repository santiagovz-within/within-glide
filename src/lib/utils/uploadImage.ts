import { createClient } from '@/lib/supabase/client';

/**
 * Uploads an image file directly from the browser to Supabase Storage,
 * completely bypassing Vercel's serverless function payload limit (4.5 MB).
 *
 * Flow:
 *   1. POST /api/upload/sign  →  tiny JSON exchange, gets a signed token
 *   2. supabase.storage.uploadToSignedUrl  →  browser-to-Supabase PUT, no Vercel involved
 */
export async function uploadImageToSupabase(file: File): Promise<string> {
  // Step 1 — get a signed upload slot from our server (no file bytes)
  const signRes = await fetch('/api/upload/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType: file.type }),
  });

  if (!signRes.ok) {
    const msg = await signRes.text().catch(() => '');
    throw new Error(
      `Could not get upload URL (${signRes.status})${msg ? ': ' + msg.slice(0, 120) : ''}.`,
    );
  }

  const { path, token, publicUrl } = await signRes.json();

  // Step 2 — upload directly from the browser to Supabase (bypasses Vercel)
  const supabase = createClient();
  const { error } = await supabase.storage
    .from('uploads')
    .uploadToSignedUrl(path, token, file, { contentType: file.type });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  return publicUrl as string;
}
