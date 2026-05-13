import { cn } from '@/lib/utils/cn';
import type { NodeStatus } from '@/types';
import { RefreshCw, Check, AlertCircle } from 'lucide-react';

interface NodeWrapperProps {
  title: string;
  icon: React.ReactNode;
  status?: NodeStatus;
  selected?: boolean;
  children: React.ReactNode;
  minWidth?: number;
  width?: number;
  accentColor?: string;
}

export function NodeWrapper({ title, icon, status, selected, children, minWidth = 280, width, accentColor }: NodeWrapperProps) {
  const color = accentColor ?? 'var(--color-accent)';
  const glow  = accentColor ? `${accentColor}4d` : 'var(--color-accent-glow)';

  return (
    <div
      className={cn('overflow-hidden transition-all duration-150')}
      style={{
        borderRadius: 17,
        background: 'var(--color-bg-elevated)',
        border: selected ? `1px solid ${color}` : 'var(--border-default)',
        boxShadow: selected
          ? `0 4px 24px rgba(0,0,0,0.5), 0 0 0 1px ${glow}`
          : 'var(--shadow-node)',
        width: width ?? minWidth,
      }}
    >
      {/* Title bar */}
      <div
        className="flex items-center justify-between px-3 py-2.5"
        style={{ borderBottom: 'var(--border-default)' }}
      >
        <div className="flex items-center gap-2">
          <span style={{ color }}>{icon}</span>
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-white-muted)' }}>
            {title}
          </span>
        </div>
        {status && status !== 'idle' && (
          <StatusBadge status={status} />
        )}
      </div>

      {/* Content */}
      <div className="p-3">{children}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: NodeStatus }) {
  if (status === 'processing') {
    return <RefreshCw size={14} className="animate-spin" style={{ color: 'var(--color-processing)' }} />;
  }
  if (status === 'completed') {
    return <Check size={14} style={{ color: 'var(--color-success)' }} />;
  }
  if (status === 'error') {
    return <AlertCircle size={14} style={{ color: 'var(--color-error)' }} />;
  }
  return null;
}
