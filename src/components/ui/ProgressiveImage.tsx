'use client';

import { useState } from 'react';

interface ProgressiveImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
  containerClassName?: string;
  containerStyle?: React.CSSProperties;
  /**
   * When true the wrapper is 100%×100% and a shimmer skeleton shows while
   * the image is in-flight. Use this when the parent already defines the
   * dimensions (e.g. an aspect-ratio box or a fill-height cell).
   */
  fill?: boolean;
}

export function ProgressiveImage({
  src,
  alt,
  className,
  style,
  containerClassName,
  containerStyle,
  fill = false,
  onLoad,
  ...rest
}: ProgressiveImageProps) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div
      className={containerClassName}
      style={{
        position: 'relative',
        overflow: 'hidden',
        ...(fill ? { width: '100%', height: '100%' } : { display: 'block' }),
        ...containerStyle,
      }}
    >
      {/* Shimmer skeleton — only in fill mode where container has known dimensions */}
      {fill && (
        <div
          className="absolute inset-0 animate-pulse"
          style={{
            background: 'var(--color-bg-elevated)',
            opacity: loaded ? 0 : 1,
            transition: 'opacity 0.3s ease',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className={className}
        style={{
          ...style,
          opacity: loaded ? 1 : 0,
          filter: loaded ? 'blur(0px)' : 'blur(16px)',
          ...(fill && { transform: loaded ? 'scale(1)' : 'scale(1.1)' }),
          transition: [
            'opacity 0.45s ease',
            'filter 0.45s ease',
            fill ? 'transform 0.45s ease' : null,
          ].filter(Boolean).join(', '),
        }}
        onLoad={(e) => {
          setLoaded(true);
          onLoad?.(e);
        }}
        {...rest}
      />
    </div>
  );
}
