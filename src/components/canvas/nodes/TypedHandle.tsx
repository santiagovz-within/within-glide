'use client';

import { Handle, Position, type HandleProps } from '@xyflow/react';
import { ImageIcon, Film, Type } from 'lucide-react';

export type PortType = 'text' | 'image' | 'video';

export const PORT_COLORS: Record<PortType, string> = {
  text:  '#3b9eff', // blue
  image: '#a855f7', // purple
  video: '#34d399', // green
};

// Registry: `nodeType:handleId:source|target` → PortType
// Used by FlowCanvas.isValidConnection to enforce type safety
export const PORT_TYPE_MAP: Record<string, PortType> = {
  'promptNode:prompt:source':              'text',
  'imageInputNode:image:source':           'image',
  'imageGenNode:prompt:target':            'text',
  'imageGenNode:reference_image:target':   'image',
  'imageGenNode:image:source':             'image',
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
  // offset from the edge as a % string, e.g. '35%' — maps to `top` or `left`
  offset?: string;
}

export function TypedHandle({ portType, offset, position, ...rest }: TypedHandleProps) {
  const color = PORT_COLORS[portType];
  const isLeft = position === Position.Left;
  const isRight = position === Position.Right;

  const offsetStyle: React.CSSProperties = offset
    ? isLeft || isRight
      ? { top: offset }
      : { left: offset }
    : {};

  return (
    <Handle
      position={position}
      {...rest}
      style={{
        width: 18,
        height: 18,
        borderRadius: '50%',
        background: 'var(--color-bg-elevated)',
        border: `2px solid ${color}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color,
        ...offsetStyle,
      }}
    >
      {/* Icon sits inside the handle circle */}
      <span
        style={{
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color,
          position: 'absolute',
        }}
      >
        <PortIcon type={portType} />
      </span>
    </Handle>
  );
}
