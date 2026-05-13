'use client';

import { Type, Image, Aperture, Film, Zap, Monitor, Grid, Layers, Sliders, Pointer } from 'lucide-react';
import type { NodeType } from '@/types';

interface NodeOption {
  type: NodeType;
  label: string;
  icon: React.ReactNode;
  category: string;
}

const NODE_OPTIONS: NodeOption[] = [
  { type: 'promptNode',        label: 'Prompt',           icon: <Type size={14} />,     category: 'Input'    },
  { type: 'imageInputNode',    label: 'Image Input',      icon: <Image size={14} />,    category: 'Input'    },
  { type: 'imageGenNode',      label: 'Image Generation', icon: <Aperture size={14} />, category: 'Generate' },
  { type: 'videoGenNode',      label: 'Video Generation', icon: <Film size={14} />,     category: 'Generate' },
  { type: 'upscaleNode',       label: 'Upscale',          icon: <Zap size={14} />,      category: 'Enhance'  },
  { type: 'modifyNode',        label: 'Modify',           icon: <Sliders size={14} />,  category: 'Enhance'  },
  { type: 'selectNode',        label: 'Select',           icon: <Pointer size={14} />,  category: 'Enhance'  },
  { type: 'outputNode',        label: 'Output',           icon: <Monitor size={14} />,  category: 'Output'   },
  { type: 'galleryOutputNode', label: 'Output Gallery',   icon: <Grid size={14} />,     category: 'Output'   },
];

const CATEGORIES = ['Input', 'Generate', 'Enhance', 'Output'];

interface NodeToolbarProps {
  x: number;
  y: number;
  onAdd: (type: NodeType) => void;
  onClose: () => void;
  selectedCount?: number;
  onGroup?: () => void;
}

const MENU_WIDTH  = 200;
const MENU_HEIGHT = 320;

export function NodeToolbar({ x, y, onAdd, onClose, selectedCount = 0, onGroup }: NodeToolbarProps) {
  const left = x + MENU_WIDTH  > window.innerWidth  ? x - MENU_WIDTH  : x;
  const top  = y + MENU_HEIGHT > window.innerHeight ? y - MENU_HEIGHT : y;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />

      <div
        className="fixed z-50 rounded-xl overflow-hidden shadow-xl"
        style={{
          left,
          top,
          width: MENU_WIDTH,
          background: 'var(--color-bg-surface)',
          border: 'var(--border-default)',
          boxShadow: 'var(--shadow-modal)',
        }}
      >
        <div className="px-3 py-2" style={{ borderBottom: 'var(--border-default)' }}>
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-white-muted)' }}>
            Add Node
          </p>
        </div>

        {/* Group action — only shown when 2+ nodes selected */}
        {selectedCount >= 2 && onGroup && (
          <>
            <button
              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-white/5"
              onClick={() => { onGroup(); onClose(); }}
            >
              <Layers size={13} style={{ color: '#f59e0b' }} />
              <p className="text-xs font-medium" style={{ color: 'var(--color-white)' }}>Group Selection</p>
            </button>
            <div style={{ height: 1, background: 'var(--color-white-subtle)', margin: '2px 12px' }} />
          </>
        )}

        {CATEGORIES.map((category) => {
          const options = NODE_OPTIONS.filter((o) => o.category === category);
          return (
            <div key={category}>
              <p className="px-3 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-white-muted)' }}>
                {category}
              </p>
              {options.map((option) => (
                <button
                  key={option.type}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-white/5"
                  onClick={() => { onAdd(option.type); onClose(); }}
                >
                  <span style={{ color: 'var(--color-white)' }}>{option.icon}</span>
                  <p className="text-xs font-medium" style={{ color: 'var(--color-white)' }}>{option.label}</p>
                </button>
              ))}
            </div>
          );
        })}

        <div className="pb-1" />
      </div>
    </>
  );
}
