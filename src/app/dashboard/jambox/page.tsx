'use client';

import { useEffect } from 'react';
import { ExternalLink } from 'lucide-react';

export default function JamBoxPage() {
  useEffect(() => {
    window.open('https://jambox-one.vercel.app/', '_blank', 'noopener,noreferrer');
  }, []);

  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center">
        <div
          className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6"
          style={{ background: 'var(--color-bg-elevated)', border: 'var(--border-default)' }}
        >
          <ExternalLink size={28} style={{ color: 'var(--color-white-muted)' }} />
        </div>
        <h1 className="text-xl font-semibold mb-2" style={{ color: 'var(--color-white)' }}>
          Opening JamBox...
        </h1>
        <p className="text-sm mb-6" style={{ color: 'var(--color-white-muted)' }}>
          JamBox is opening in a new window.
        </p>
        <button
          onClick={() => window.open('https://jambox-one.vercel.app/', '_blank', 'noopener,noreferrer')}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-80"
          style={{ background: 'var(--color-accent)', color: '#fff' }}
        >
          <ExternalLink size={14} />
          Open JamBox
        </button>
      </div>
    </div>
  );
}
