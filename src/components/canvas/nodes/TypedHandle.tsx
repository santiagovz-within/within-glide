'use client';

import { Handle, Position, type HandleProps } from '@xyflow/react';
import { ImageIcon, Film, Type } from 'lucide-react';

export type PortType = 'text' | 'image' | 'video';

export const PORT_COLORS: Record<PortType, string> = {
  text:  '#3b9eff',
  image: '#a855f7',
  video: '#34d399',
};

export const PORT_TINTS: Record<PortType, string> = {
  text:  '#1e3f6a',
  image: '#3a1a6a',
  video: '#114a32',
};

// Registry: `nodeType:handleId:source|target` → PortType
// Used by FlowCanvas.isValidConnection to enforce type safety
export const PORT_TYPE_MAP: Record<string, PortType> = {
  'promptNode:prompt:source':              'text',
  'imageInputNode:image:source':           'image',
  'imageGenNode:prompt:target':            'text',
  'imageGenNode:reference_image:target':   'image',
  'imageGenNode:image:source':             'image',
  // Dynamic multi-image reference handles (Google models, up to 14)
  ...Object.fromEntries(
    Array.from({ length: 14 }, (_, i) => [`imageGenNode:ref_${i}:target`, 'image' as PortType])
  ),
  'videoGenNode:prompt:target':            'text',
  'videoGenNode:start_frame:target':       'image',
  'videoGenNode:end_frame:target':         'image',
  'videoGenNode:video:source':             'video',
  'upscaleNode:image:target':              'image',
  'upscaleNode:image:source':              'image',
  'outputNode:image:target':               'image',
  'outputNode:video:target':               'video',
};

function PortIcon({ type, size = 9 }: { type: PortType; size?: number }) {
  if (type === 'image') return <ImageIcon size={size} />;
  if (type === 'video') return <Film size={size} />;
  return <Type size={size} />;
}

interface TypedHandleProps extends Omit<HandleProps, 'style'> {
  portType: PortType;
  // offset from the edge as a % string or px value, e.g. '35%' or '240px'
  offset?: string;
  // small numeric badge shown above the handle circle (for numbered multi-image slots)
  badge?: number;
}

export function TypedHandle({ portType, offset, position, badge, ...rest }: TypedHandleProps) {
  const color = PORT_COLORS[portType];
  const tint  = PORT_TINTS[portType];
  const isLeft = position === Position.Left;
  const isRight = position === Position.Right;

  const offsetStyle: React.CSSProperties = {
    ...(offset
      ? isLeft || isRight
        ? { top: offset }
        : { left: offset }
      : {}),
    // Push the circle 15px outside the node border
    ...(isLeft  ? { left:  -15 } : {}),
    ...(isRight ? { right: -15 } : {}),
  };

  return (
    <Handle
      position={position}
      {...rest}
      style={{
        width: 36,
        height: 36,
        borderRadius: '50%',
        background: tint,
        border: `1.5px solid ${color}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color,
        pointerEvents: 'all',
        ...offsetStyle,
      }}
    >
      <PortIcon type={portType} size={14} />
      {badge !== undefined && (
        <span
          style={{
            position: 'absolute',
            top: -8,
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: 8,
            lineHeight: '10px',
            padding: '0 3px',
            borderRadius: 4,
            background: 'var(--color-bg-darkest)',
            border: `1px solid ${color}`,
            color,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {badge}
        </span>
      )}
    </Handle>
  );
}
