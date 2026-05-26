/**
 * Uploads an image file directly from the browser to Google Cloud Storage,
 * completely bypassing Vercel's serverless function payload limit (4.5 MB).
 *
 * Flow:
 *   1. POST /api/upload/sign  →  tiny JSON exchange, gets signed write + read URLs
 *   2. fetch(uploadUrl, PUT)  →  browser-to-GCS PUT, no Vercel involved
 */
export async function uploadImageToStorage(file: File): Promise<string> {
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

  const { uploadUrl, readUrl } = await signRes.json() as { uploadUrl: string; readUrl: string };

  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
  });

  if (!putRes.ok) {
    throw new Error(`Storage upload failed: ${putRes.status} ${putRes.statusText}`);
  }

  return readUrl;
}
