'use client';

import { useState } from 'react';

export function LoginCoverImage({ src }: { src: string }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="hidden lg:flex flex-1 p-3 min-h-screen">
      <div
        className="w-full h-full rounded-2xl overflow-hidden"
        style={{ background: 'var(--color-bg-darkest)' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          onLoad={() => setLoaded(true)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
            opacity: loaded ? 1 : 0,
            transition: 'opacity 0.5s ease',
          }}
        />
      </div>
    </div>
  );
}
