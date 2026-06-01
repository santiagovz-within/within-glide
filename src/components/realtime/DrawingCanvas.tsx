'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DrawingCanvasHandle {
  clear: () => void;
  getDataUrl: () => string;
}

interface DrawingCanvasProps {
  imageSize: { width: number; height: number };
  activeTool: 'brush' | 'eraser';
  brushColor: string;
  brushSize: number;
  eraserSize: number;
  onStrokeEnd: (dataUri: string) => void;
  pendingImage: HTMLImageElement | null;
  onImagePlaced: () => void;
  disabled?: boolean;
  /** Optional explicit CSS display size for the outer wrapper. */
  wrapperStyle?: React.CSSProperties;
}

// ---------------------------------------------------------------------------
// Overlay state
// ---------------------------------------------------------------------------

interface OverlayRect {
  /** percentage of overlay container width/height (0–100) */
  x: number;
  y: number;
  w: number;
  h: number;
}

type ResizeCorner = 'tl' | 'tr' | 'bl' | 'br';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const DrawingCanvas = forwardRef<DrawingCanvasHandle, DrawingCanvasProps>(
  function DrawingCanvas(
    {
      imageSize,
      activeTool,
      brushColor,
      brushSize,
      eraserSize,
      onStrokeEnd,
      pendingImage,
      onImagePlaced,
      disabled = false,
      wrapperStyle,
    },
    ref
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // -----------------------------------------------------------------------
    // Drawing state
    // -----------------------------------------------------------------------
    const isDrawing = useRef(false);
    const lastPos = useRef<{ x: number; y: number } | null>(null);

    // -----------------------------------------------------------------------
    // Overlay state
    // -----------------------------------------------------------------------
    const [overlay, setOverlay] = useState<OverlayRect | null>(null);
    const overlayDivRef = useRef<HTMLDivElement>(null);

    // Refs for drag / resize interactions on the overlay
    const dragState = useRef<{
      type: 'move' | ResizeCorner;
      startMouseX: number;
      startMouseY: number;
      startRect: OverlayRect;
    } | null>(null);

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    const fillWhite = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }, []);

    const emitStrokeEnd = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      onStrokeEnd(canvas.toDataURL('image/png'));
    }, [onStrokeEnd]);

    // -----------------------------------------------------------------------
    // Imperative handle
    // -----------------------------------------------------------------------

    useImperativeHandle(
      ref,
      () => ({
        clear: () => {
          fillWhite();
          emitStrokeEnd();
        },
        getDataUrl: () => {
          return canvasRef.current?.toDataURL('image/png') ?? '';
        },
      }),
      [fillWhite, emitStrokeEnd]
    );

    // -----------------------------------------------------------------------
    // Init / resize canvas with white fill
    // -----------------------------------------------------------------------

    useEffect(() => {
      fillWhite();
    }, [imageSize, fillWhite]);

    // -----------------------------------------------------------------------
    // Show overlay when pendingImage changes
    // -----------------------------------------------------------------------

    useEffect(() => {
      if (!pendingImage) {
        setOverlay(null);
        return;
      }
      // Center a 50%-wide overlay, maintain image aspect ratio
      const aspect = pendingImage.naturalWidth / pendingImage.naturalHeight;
      const w = 50;
      const h = (w / aspect) * (imageSize.width / imageSize.height);
      setOverlay({
        x: (100 - w) / 2,
        y: (100 - h) / 2,
        w,
        h,
      });
    }, [pendingImage, imageSize]);

    // -----------------------------------------------------------------------
    // Canvas pointer events — drawing
    // -----------------------------------------------------------------------

    const getCanvasPos = useCallback(
      (e: React.PointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current!;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
          x: (e.clientX - rect.left) * scaleX,
          y: (e.clientY - rect.top) * scaleY,
        };
      },
      []
    );

    const handlePointerDown = useCallback(
      (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (disabled || overlay) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        isDrawing.current = true;
        lastPos.current = getCanvasPos(e);

        // Draw a single dot on click
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext('2d')!;
        const pos = lastPos.current;
        const size = activeTool === 'eraser' ? eraserSize : brushSize;

        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = activeTool === 'eraser' ? '#ffffff' : brushColor;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, size / 2, 0, Math.PI * 2);
        ctx.fill();
      },
      [disabled, overlay, getCanvasPos, activeTool, brushColor, brushSize, eraserSize]
    );

    const handlePointerMove = useCallback(
      (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!isDrawing.current || disabled) return;
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext('2d')!;
        const pos = getCanvasPos(e);
        const prev = lastPos.current ?? pos;

        const size = activeTool === 'eraser' ? eraserSize : brushSize;
        const color = activeTool === 'eraser' ? '#ffffff' : brushColor;

        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = color;
        ctx.lineWidth = size;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();

        lastPos.current = pos;
      },
      [disabled, getCanvasPos, activeTool, brushColor, brushSize, eraserSize]
    );

    const handlePointerUp = useCallback(
      (_e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!isDrawing.current) return;
        isDrawing.current = false;
        lastPos.current = null;
        emitStrokeEnd();
      },
      [emitStrokeEnd]
    );

    const handlePointerLeave = useCallback(
      (_e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!isDrawing.current) return;
        isDrawing.current = false;
        lastPos.current = null;
        emitStrokeEnd();
      },
      [emitStrokeEnd]
    );

    // -----------------------------------------------------------------------
    // Overlay drag / resize — pointer events on the overlay container
    // -----------------------------------------------------------------------

    const overlayPointerDown = useCallback(
      (e: React.PointerEvent<HTMLDivElement>, type: 'move' | ResizeCorner) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        if (!overlay) return;
        dragState.current = {
          type,
          startMouseX: e.clientX,
          startMouseY: e.clientY,
          startRect: { ...overlay },
        };
      },
      [overlay]
    );

    const overlayPointerMove = useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        if (!dragState.current || !overlay || !overlayDivRef.current) return;
        e.stopPropagation();

        const container = overlayDivRef.current;
        const containerW = container.offsetWidth;
        const containerH = container.offsetHeight;

        const dxPct = ((e.clientX - dragState.current.startMouseX) / containerW) * 100;
        const dyPct = ((e.clientY - dragState.current.startMouseY) / containerH) * 100;

        const { startRect, type } = dragState.current;

        let { x, y, w, h } = startRect;
        const minSize = 5; // % minimum

        if (type === 'move') {
          x = Math.max(0, Math.min(100 - w, startRect.x + dxPct));
          y = Math.max(0, Math.min(100 - h, startRect.y + dyPct));
        } else {
          // Resize corners: adjust x/y/w/h depending on which corner
          if (type === 'tl') {
            const newW = Math.max(minSize, startRect.w - dxPct);
            const newH = Math.max(minSize, startRect.h - dyPct);
            x = startRect.x + startRect.w - newW;
            y = startRect.y + startRect.h - newH;
            w = newW;
            h = newH;
          } else if (type === 'tr') {
            const newW = Math.max(minSize, startRect.w + dxPct);
            const newH = Math.max(minSize, startRect.h - dyPct);
            y = startRect.y + startRect.h - newH;
            w = newW;
            h = newH;
          } else if (type === 'bl') {
            const newW = Math.max(minSize, startRect.w - dxPct);
            x = startRect.x + startRect.w - newW;
            w = newW;
            h = Math.max(minSize, startRect.h + dyPct);
          } else if (type === 'br') {
            w = Math.max(minSize, startRect.w + dxPct);
            h = Math.max(minSize, startRect.h + dyPct);
          }
        }

        setOverlay({ x, y, w, h });
      },
      [overlay]
    );

    const overlayPointerUp = useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        e.stopPropagation();
        dragState.current = null;
      },
      []
    );

    // -----------------------------------------------------------------------
    // Stamp / dismiss
    // -----------------------------------------------------------------------

    const stampImage = useCallback(() => {
      if (!pendingImage || !overlay || !canvasRef.current) return;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d')!;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      // overlay percentages → pixel coords relative to rendered canvas element
      const renderedX = (overlay.x / 100) * rect.width;
      const renderedY = (overlay.y / 100) * rect.height;
      const renderedW = (overlay.w / 100) * rect.width;
      const renderedH = (overlay.h / 100) * rect.height;

      // Scale to actual canvas resolution
      const canvasX = renderedX * scaleX;
      const canvasY = renderedY * scaleY;
      const canvasW = renderedW * scaleX;
      const canvasH = renderedH * scaleY;

      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(pendingImage, canvasX, canvasY, canvasW, canvasH);

      // Keep the overlay so the image can be repositioned and stamped again.
      // Dismiss (×) is the only way to remove it.
      emitStrokeEnd();
    }, [pendingImage, overlay, emitStrokeEnd]);

    const dismissImage = useCallback(() => {
      setOverlay(null);
      onImagePlaced();
      emitStrokeEnd();
    }, [emitStrokeEnd, onImagePlaced]);

    // -----------------------------------------------------------------------
    // Cursor style
    // -----------------------------------------------------------------------

    const canvasCursor = disabled || overlay
      ? 'default'
      : activeTool === 'eraser'
      ? 'cell'
      : 'crosshair';

    // -----------------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------------

    return (
      <div style={{ position: 'relative', display: 'inline-block', ...wrapperStyle }}>
        {/* The actual drawing canvas */}
        <canvas
          ref={canvasRef}
          width={imageSize.width}
          height={imageSize.height}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            cursor: canvasCursor,
            touchAction: 'none',
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
        />

        {/* Overlay layer — only rendered when there is a pendingImage */}
        {overlay && pendingImage && (
          <div
            ref={overlayDivRef}
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
            }}
            onPointerMove={overlayPointerMove}
            onPointerUp={overlayPointerUp}
          >
            {/* Draggable image box */}
            <div
              style={{
                position: 'absolute',
                left: `${overlay.x}%`,
                top: `${overlay.y}%`,
                width: `${overlay.w}%`,
                height: `${overlay.h}%`,
                boxSizing: 'border-box',
                border: '1.5px dashed rgba(255,255,255,0.7)',
                pointerEvents: 'all',
                cursor: 'move',
                userSelect: 'none',
              }}
              onPointerDown={(e) => overlayPointerDown(e, 'move')}
            >
              {/* Image preview */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pendingImage.src}
                alt="overlay"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'fill',
                  display: 'block',
                  pointerEvents: 'none',
                  userSelect: 'none',
                  draggable: false,
                } as React.CSSProperties}
                draggable={false}
              />

              {/* Stamp button — center of overlay */}
              <button
                onClick={stampImage}
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  background: '#ffffff',
                  color: '#000000',
                  border: 'none',
                  borderRadius: '999px',
                  padding: '4px 10px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  boxShadow: '0 1px 6px rgba(0,0,0,0.35)',
                  pointerEvents: 'all',
                  zIndex: 10,
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                ✓ Stamp
              </button>

              {/* Dismiss button — top-right corner */}
              <button
                onClick={dismissImage}
                style={{
                  position: 'absolute',
                  top: -10,
                  right: -10,
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: '#1a1a1a',
                  color: '#ffffff',
                  border: '1.5px solid rgba(255,255,255,0.4)',
                  fontSize: '11px',
                  lineHeight: '1',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  pointerEvents: 'all',
                  zIndex: 10,
                  boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                ×
              </button>

              {/* Corner resize handles */}
              {(['tl', 'tr', 'bl', 'br'] as ResizeCorner[]).map((corner) => (
                <div
                  key={corner}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    overlayPointerDown(e, corner);
                  }}
                  style={{
                    position: 'absolute',
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: '#ffffff',
                    border: '2px solid rgba(0,0,0,0.5)',
                    boxSizing: 'border-box',
                    pointerEvents: 'all',
                    zIndex: 11,
                    cursor:
                      corner === 'tl' || corner === 'br'
                        ? 'nwse-resize'
                        : 'nesw-resize',
                    ...(corner === 'tl' && { top: -6, left: -6 }),
                    ...(corner === 'tr' && { top: -6, right: -6 }),
                    ...(corner === 'bl' && { bottom: -6, left: -6 }),
                    ...(corner === 'br' && { bottom: -6, right: -6 }),
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }
);

DrawingCanvas.displayName = 'DrawingCanvas';

export { DrawingCanvas };
export type { DrawingCanvasProps };
