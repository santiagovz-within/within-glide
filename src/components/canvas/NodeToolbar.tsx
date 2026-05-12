'use client';

import { Type, ImageIcon, Wand2, Film, Zap, MonitorPlay, LayoutGrid, Layers } from 'lucide-react';
import type { NodeType } from '@/types';

interface NodeOption {
  type: NodeType;
  label: string;
  description: string;
  icon: React.ReactNode;
  category: string;
}

const NODE_OPTIONS: NodeOption[] = [
  { type: 'promptNode',       label: 'Prompt',           description: 'Text prompt input',               icon: <Type size={14} />,        category: 'Input'    },
  { type: 'imageInputNode',   label: 'Image Input',      description: 'Upload a reference image',        icon: <ImageIcon size={14} />,   category: 'Input'    },
  { type: 'imageGenNode',     label: 'Image Generation', description: 'Generate images with AI',         icon: <Wand2 size={14} />,       category: 'Generate' },
  { type: 'videoGenNode',     label: 'Video Generation', description: 'Generate videos with AI',         icon: <Film size={14} />,        category: 'Generate' },
  { type: 'upscaleNode',      label: 'Upscale',          description: 'Enhance image resolution',        icon: <Zap size={14} />,         category: 'Enhance'  },
  { type: 'outputNode',       label: 'Output',           description: 'Preview and download result',     icon: <MonitorPlay size={14} />, category: 'Output'   },
  { type: 'galleryOutputNode',label: 'Output Gallery',   description: 'Grid view of all connected assets', icon: <LayoutGrid size={14} />, category: 'Output'  },
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

const MENU_WIDTH  = 220;
const MENU_HEIGHT = 440;

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
            <div className="px-3 pt-2 pb-1">
              <p className="text-xs font-medium" style={{ color: 'var(--color-white-muted)' }}>
                Selection ({selectedCount} nodes)
              </p>
            </div>
            <button
              className="w-full flex items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-white/5"
              onClick={() => { onGroup(); onClose(); }}
            >
              <Layers size={14} style={{ color: '#f59e0b' }} />
              <div>
                <p className="text-xs font-medium" style={{ color: 'var(--color-white)' }}>Group Selection</p>
                <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>
                  Wrap selected nodes in a group
                </p>
              </div>
            </button>
            <div style={{ height: 1, background: 'var(--color-white-subtle)', margin: '4px 12px' }} />
          </>
        )}

        {CATEGORIES.map((category) => {
          const options = NODE_OPTIONS.filter((o) => o.category === category);
          return (
            <div key={category}>
              <p className="px-3 pt-2 pb-1 text-xs font-medium" style={{ color: 'var(--color-white-muted)' }}>
                {category}
              </p>
              {options.map((option) => (
                <button
                  key={option.type}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-white/5"
                  onClick={() => { onAdd(option.type); onClose(); }}
                >
                  <span style={{ color: 'var(--color-accent)' }}>{option.icon}</span>
                  <div>
                    <p className="text-xs font-medium" style={{ color: 'var(--color-white)' }}>{option.label}</p>
                    <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>{option.description}</p>
                  </div>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}
