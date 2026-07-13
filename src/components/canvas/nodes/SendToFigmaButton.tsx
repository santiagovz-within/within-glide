'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = src;
  });
}

// Compress + resize for Figma: max 4096px on longest side; PNG stays PNG
// (preserves transparency); everything else → JPEG at 0.85 quality.
// Dimensions are verified from the output blob so they match exactly what
// the Figma plugin reads via figma.createImage().
async function compressForFigma(rawBlob: Blob): Promise<{
  blob: Blob; width: number; height: number; contentType: string;
}> {
  const MAX_DIM = 4096;
  const inputUrl = URL.createObjectURL(rawBlob);
  let outputUrl: string | null = null;
  try {
    const img = await loadImage(inputUrl);

    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (w <= 0 || h <= 0) throw new Error('Could not read image dimensions');

    if (w > MAX_DIM || h > MAX_DIM) {
      const ratio = Math.min(MAX_DIM / w, MAX_DIM / h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);

    const isPng = rawBlob.type === 'image/png';
    const outputType = isPng ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        b => (b ? resolve(b) : reject(new Error('Canvas compression failed'))),
        outputType,
        isPng ? undefined : 0.85,
      ),
    );

    // Reload the output blob to get the authoritative pixel dimensions —
    // this is exactly what the Figma plugin reads from the downloaded file.
    outputUrl = URL.createObjectURL(blob);
    const out = await loadImage(outputUrl);
    return { blob, width: out.naturalWidth, height: out.naturalHeight, contentType: outputType };
  } finally {
    URL.revokeObjectURL(inputUrl);
    if (outputUrl) URL.revokeObjectURL(outputUrl);
  }
}

type FigmaStatus = 'idle' | 'sending' | 'sent' | 'no_token' | 'error';

function FigmaIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 38 57" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <path d="M19 28.5a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0z" fill="currentColor" opacity="0.9"/>
      <path d="M0 47.5A9.5 9.5 0 0 1 9.5 38H19v9.5a9.5 9.5 0 0 1-19 0z" fill="currentColor" opacity="0.6"/>
      <path d="M19 0v19H9.5a9.5 9.5 0 0 1 0-19H19z" fill="currentColor" opacity="0.7"/>
      <path d="M0 19a9.5 9.5 0 0 1 9.5-9.5H19V28.5H9.5A9.5 9.5 0 0 1 0 19z" fill="currentColor" opacity="0.8"/>
      <path d="M19 0h9.5a9.5 9.5 0 0 1 0 19H19V0z" fill="currentColor"/>
    </svg>
  );
}

interface SendToFigmaButtonProps {
  imageUrl: string | undefined;
  style?: React.CSSProperties;
}

export function SendToFigmaButton({ imageUrl, style }: SendToFigmaButtonProps) {
  const [status, setStatus] = useState<FigmaStatus>('idle');
  const [error,  setError]  = useState<string | null>(null);

  if (!imageUrl) return null;

  async function handleSend() {
    if (!imageUrl || status === 'sending') return;
    setStatus('sending');
    setError(null);

    try {
      // 1. Verify the user has generated their plugin link token.
      const tokenRes = await fetch('/api/figma/token');
      if (!tokenRes.ok) throw new Error('Could not check Figma token status');
      const { configured } = await tokenRes.json();
      if (!configured) {
        setStatus('no_token');
        return;
      }

      // 2. Fetch the image blob — the response Content-Type tells us the format.
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) throw new Error('Could not fetch image');
      const rawBlob = await imgRes.blob();

      // 3. Compress + resize to fit Figma's limits (max 4096px, JPEG 0.85 or PNG).
      const { blob, width, height, contentType } = await compressForFigma(rawBlob);

      // 4. Stage — backend returns a signed GCS PUT URL.
      const stageRes = await fetch('/api/figma/stage', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sizeBytes: blob.size, width, height, contentType }),
      });
      if (!stageRes.ok) {
        const e = await stageRes.json().catch(() => ({}));
        throw new Error((e as { error?: string }).error ?? 'Stage request failed');
      }
      const { id: transferId, uploadUrl } = await stageRes.json() as { id: string; uploadUrl: string };

      // 5. Upload blob directly to GCS (bypasses Vercel body-size limit).
      const putRes = await fetch(uploadUrl, {
        method:  'PUT',
        body:    blob,
        headers: { 'Content-Type': contentType },
      });
      if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);

      // 6. Confirm — transitions transfer to 'pending' so the plugin picks it up.
      const confirmRes = await fetch(`/api/figma/stage/${transferId}/confirm`, { method: 'POST' });
      if (!confirmRes.ok) {
        const e = await confirmRes.json().catch(() => ({}));
        throw new Error((e as { error?: string }).error ?? 'Confirm failed');
      }

      setStatus('sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setStatus('error');
    }
  }

  return (
    <div style={style}>
      <button
        onClick={handleSend}
        disabled={status === 'sending'}
        className="w-full flex items-center justify-center gap-1.5 py-3 text-xs font-medium nodrag transition-opacity hover:opacity-80 active:opacity-60 disabled:opacity-50"
        style={{
          borderRadius: 11,
          background: status === 'sent'
            ? 'rgba(34,197,94,0.15)'
            : 'rgba(255,255,255,0.06)',
          color: status === 'sent'
            ? 'var(--color-success)'
            : status === 'error' || status === 'no_token'
            ? '#f87171'
            : 'var(--color-white-muted)',
          border: status === 'sent'
            ? '1px solid rgba(34,197,94,0.3)'
            : status === 'error' || status === 'no_token'
            ? '1px solid rgba(239,68,68,0.3)'
            : '1px solid transparent',
          cursor: 'pointer',
        }}
      >
        {status === 'sending' ? (
          <>
            <div
              className="animate-spin"
              style={{ width: 11, height: 11, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.2)', borderTopColor: 'var(--color-white-muted)', flexShrink: 0 }}
            />
            Sending…
          </>
        ) : status === 'sent' ? (
          <>
            <Check size={12} style={{ color: 'var(--color-success)' }} />
            Sent to Figma
          </>
        ) : (
          <>
            <FigmaIcon size={12} />
            Send to Figma
          </>
        )}
      </button>

      {status === 'no_token' && (
        <p className="text-center mt-1 nodrag" style={{ fontSize: 10, color: '#f87171' }}>
          Go to{' '}
          <button
            className="underline"
            style={{ color: '#f87171', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 10 }}
            onClick={() => window.open('/dashboard/settings', '_blank')}
          >
            Settings → Figma Integration
          </button>{' '}
          to generate your link token.
        </p>
      )}

      {status === 'error' && error && (
        <p className="text-center mt-1 nodrag" style={{ fontSize: 10, color: '#f87171' }}>
          {error}
        </p>
      )}

      {status === 'sent' && (
        <p className="text-center mt-1 nodrag" style={{ fontSize: 10, color: 'var(--color-white-muted)' }}>
          Make sure the Figma plugin is open in your target file — the image will drop into whatever file is open.
        </p>
      )}

      {status === 'idle' && (
        <p className="text-center mt-1 nodrag" style={{ fontSize: 10, color: 'var(--color-white-muted)', opacity: 0.6 }}>
          Make sure the Figma plugin is open in your target file.
        </p>
      )}
    </div>
  );
}
