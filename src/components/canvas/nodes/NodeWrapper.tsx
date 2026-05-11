import { cn } from '@/lib/utils/cn';
import type { NodeStatus } from '@/types';
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react';

interface NodeWrapperProps {
  title: string;
  icon: React.ReactNode;
  status?: NodeStatus;
  selected?: boolean;
  children: React.ReactNode;
  minWidth?: number;
  width?: number;
}

export function NodeWrapper({ title, icon, status, selected, children, minWidth = 280, width }: NodeWrapperProps) {
  return (
    <div
      className={cn(
        'rounded-xl overflow-hidden transition-all duration-150',
        selected && 'ring-1 ring-[var(--color-accent)]'
      )}
      style={{
        background: 'var(--color-bg-elevated)',
        border: selected ? '1px solid var(--color-accent)' : 'var(--border-default)',
        boxShadow: selected
          ? '0 4px 24px rgba(0,0,0,0.5), 0 0 0 1px var(--color-accent-glow)'
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
          <span style={{ color: 'var(--color-accent)' }}>{icon}</span>
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
    return <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-processing)' }} />;
  }
  if (status === 'completed') {
    return <CheckCircle size={14} style={{ color: 'var(--color-success)' }} />;
  }
  if (status === 'error') {
    return <AlertCircle size={14} style={{ color: 'var(--color-error)' }} />;
  }
  return null;
}
