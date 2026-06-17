'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface NodeSelectProps {
  options: string[];
  value: string;
  onChange: (value: string) => void;
}

export function NodeSelect({ options, value, onChange }: NodeSelectProps) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onOutsideDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onOutsideDown, true);
    return () => document.removeEventListener('mousedown', onOutsideDown, true);
  }, [open]);

  return (
    <div ref={ref} className="nodrag" style={{ position: 'relative' }}>
      <button
        className="nodrag w-full h-full flex items-center gap-1.5 px-2 py-1.5 text-xs"
        style={{
          background: 'var(--color-bg-surface)',
          color: 'var(--color-white)',
          border: 'none',
          borderRadius: 11,
          cursor: 'pointer',
          textAlign: 'left',
          outline: 'none',
          lineHeight: 1.4,
        }}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      >
        <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</span>
        <ChevronDown
          size={20}
          style={{
            opacity: 0.6,
            flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s',
          }}
        />
      </button>

      {open && (
        <div
          className="nodrag"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 3,
            background: 'var(--color-bg-surface)',
            borderRadius: 11,
            border: '1px solid rgba(255,255,255,0.1)',
            overflow: 'hidden',
            zIndex: 9999,
          }}
        >
          {options.map((opt) => (
            <button
              key={opt}
              className="nodrag w-full flex items-center px-2 py-1.5 text-xs"
              style={{
                color: opt === value ? 'var(--color-white)' : 'var(--color-white-muted)',
                background:
                  hovered === opt
                    ? 'rgba(255,255,255,0.07)'
                    : opt === value
                    ? 'rgba(255,255,255,0.04)'
                    : 'transparent',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                outline: 'none',
                lineHeight: 1.4,
              }}
              onMouseEnter={() => setHovered(opt)}
              onMouseLeave={() => setHovered(null)}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => { onChange(opt); setOpen(false); }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
