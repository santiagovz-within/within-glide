'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fal } from '@fal-ai/client';
import { DrawingCanvas, type DrawingCanvasHandle } from './DrawingCanvas';
import { Brush, Camera, Eraser, Upload, Trash2, Zap } from 'lucide-react';

// ─── Constants ─────────────────────────────────────────────────────────────────

const CAP_USD = 10;
const COST_PER_REQUEST = 2 * 0.00194; // 2 compute seconds @ $0.00194/s

const IMAGE_SIZES = {
  standard: { width: 512, height: 512 },
  hd:       { width: 768, height: 768 },
} as const;

const FAL_IMAGE_SIZES = {
  standard: 'square',
  hd:       'square_hd',
} as const;

const BRUSH_COLORS = [
  '#000000', '#ffffff', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#3b82f6', '#a855f7',
  '#ec4899', '#94a3b8',
];

// ─── Types ─────────────────────────────────────────────────────────────────────

type Quality = 'standard' | 'hd';
interface UsageState { costUsd: number; requestCount: number }

interface FluxInput {
  prompt: string;
  image_url: string;
  num_inference_steps: number;
  image_size: 'square' | 'square_hd';
}
interface FluxImage {
  content: ArrayBuffer;
  content_type: string;
  width: number;
  height: number;
}
type FluxResult = { images?: FluxImage[] };

// ─── Component ─────────────────────────────────────────────────────────────────

export function RealtimePage() {
  // Tool state
  const [activeTool,  setActiveTool]  = useState<'brush' | 'eraser'>('brush');
  const [brushColor,  setBrushColor]  = useState('#000000');
  const [brushSize,   setBrushSize]   = useState(10);
  const [eraserSize,  setEraserSize]  = useState(20);
  const [openPopover, setOpenPopover] = useState<'brush' | 'eraser' | null>(null);

  // Generation state
  const [prompt,       setPrompt]       = useState('');
  const [quality,      setQuality]      = useState<Quality>('standard');
  const [resultUrl,    setResultUrl]    = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [connError,    setConnError]    = useState<string | null>(null);

  // Usage state
  const [usage, setUsage] = useState<UsageState>({ costUsd: 0, requestCount: 0 });

  // Image upload
  const [pendingImage,  setPendingImage] = useState<HTMLImageElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  // Webcam
  const [webcamActive,  setWebcamActive] = useState(false);
  const webcamActiveRef  = useRef(false);
  const videoRef         = useRef<HTMLVideoElement>(null);
  const streamRef        = useRef<MediaStream | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef     = useRef<number>(0);
  const lastSendRef      = useRef<number>(0);

  // Core refs
  const canvasHandle     = useRef<DrawingCanvasHandle>(null);
  const connectionRef    = useRef<ReturnType<typeof fal.realtime.connect<FluxInput, FluxResult>> | null>(null);
  const debounceRef      = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastDataUriRef   = useRef<string>('');
  const resultUrlRef     = useRef<string | null>(null);
  const leftContainerRef = useRef<HTMLDivElement>(null);
  const qualityRef       = useRef<Quality>('standard');
  const promptRef        = useRef('');

  // Keep refs in sync with state
  useEffect(() => { qualityRef.current = quality; }, [quality]);
  useEffect(() => { promptRef.current = prompt; }, [prompt]);

  const isCapExceeded = usage.costUsd >= CAP_USD;
  const usagePct      = Math.min(100, (usage.costUsd / CAP_USD) * 100);

  // Canvas display size (px), fitted to left panel
  const [canvasDisplay, setCanvasDisplay] = useState({ w: 512, h: 512 });

  // ── Fetch usage on mount ────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/realtime/usage')
      .then(r => r.json())
      .then(d => setUsage({ costUsd: d.costUsd ?? 0, requestCount: d.requestCount ?? 0 }))
      .catch(() => {});
  }, []);

  // ── Canvas display size via ResizeObserver ──────────────────────────────────
  useEffect(() => {
    const el = leftContainerRef.current;
    if (!el) return;
    const { width: pw, height: ph } = IMAGE_SIZES[quality];
    const PADDING = 32;

    const compute = () => {
      const cw = el.clientWidth  - PADDING;
      const ch = el.clientHeight - PADDING;
      if (cw <= 0 || ch <= 0) return;
      const scale = Math.min(cw / pw, ch / ph, 1);
      setCanvasDisplay({ w: Math.floor(pw * scale), h: Math.floor(ph * scale) });
    };

    const ro = new ResizeObserver(compute);
    ro.observe(el);
    compute();
    return () => ro.disconnect();
  }, [quality]);

  // ── Blob URL tracking ───────────────────────────────────────────────────────
  const setAndTrackResultUrl = useCallback((url: string) => {
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    resultUrlRef.current = url;
    setResultUrl(url);
  }, []);

  // ── FAL token provider ──────────────────────────────────────────────────────
  const tokenProvider = useCallback(async (app: string) => {
    const res  = await fetch(`/api/fal/realtime-token?app=${encodeURIComponent(app)}`);
    const data = await res.json();
    return data.token as string;
  }, []);

  // ── FAL realtime connection ─────────────────────────────────────────────────
  useEffect(() => {
    const conn = fal.realtime.connect<FluxInput, FluxResult>(
      'fal-ai/flux-2/klein/realtime',
      {
        connectionKey: 'realtime-canvas',
        clientOnly: true,
        tokenProvider,
        tokenExpirationSeconds: 120,
        onResult(result) {
          const img = result.images?.[0];
          if (img?.content) {
            const blob = new Blob([img.content], { type: img.content_type || 'image/jpeg' });
            const url  = URL.createObjectURL(blob);
            setAndTrackResultUrl(url);
            setIsGenerating(false);
            setConnError(null);
            setUsage(prev => ({
              costUsd:      prev.costUsd + COST_PER_REQUEST,
              requestCount: prev.requestCount + 1,
            }));
            fetch('/api/realtime/usage', { method: 'POST' }).catch(() => {});
          }
        },
        onError(error) {
          console.error('[RealtimePage]', error);
          setConnError(error.message || 'Connection error');
          setIsGenerating(false);
        },
      },
    );

    connectionRef.current = conn;
    return () => {
      conn.close();
      connectionRef.current = null;
    };
  }, [tokenProvider, setAndTrackResultUrl]);

  // ── Debounced send after stroke ends ───────────────────────────────────────
  const handleStrokeEnd = useCallback((dataUri: string) => {
    if (isCapExceeded || !dataUri || webcamActiveRef.current) return;
    lastDataUriRef.current = dataUri;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!lastDataUriRef.current || !connectionRef.current) return;
      setIsGenerating(true);
      connectionRef.current.send({
        prompt:              promptRef.current,
        image_url:           lastDataUriRef.current,
        num_inference_steps: 3,
        image_size:          FAL_IMAGE_SIZES[qualityRef.current],
      });
    }, 500);
  }, [isCapExceeded]);

  // ── Image upload ────────────────────────────────────────────────────────────
  function handleUploadChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { setActiveTool('brush'); setPendingImage(img); };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }

  function handleImagePlaced() {
    if (pendingImage) URL.revokeObjectURL(pendingImage.src);
    setPendingImage(null);
  }

  // ── Webcam ──────────────────────────────────────────────────────────────────

  const captureFrame = useCallback((): string | null => {
    const video  = videoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas || video.readyState < 2) return null;

    const { width, height } = IMAGE_SIZES[qualityRef.current];
    canvas.width  = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;

    // Center-crop to square
    const side = Math.min(vw, vh);
    const sx   = (vw - side) / 2;
    const sy   = (vh - side) / 2;
    ctx.drawImage(video, sx, sy, side, side, 0, 0, width, height);

    return canvas.toDataURL('image/jpeg', 0.85);
  }, []);

  const webcamLoop = useCallback(() => {
    if (!webcamActiveRef.current) return;

    const now = Date.now();
    if (now - lastSendRef.current >= 300) {
      const frame = captureFrame();
      if (frame && connectionRef.current) {
        lastSendRef.current = now;
        setIsGenerating(true);
        connectionRef.current.send({
          prompt:              promptRef.current,
          image_url:           frame,
          num_inference_steps: 3,
          image_size:          FAL_IMAGE_SIZES[qualityRef.current],
        });
      }
    }

    animFrameRef.current = requestAnimationFrame(webcamLoop);
  }, [captureFrame]);

  const enableWebcam = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      webcamActiveRef.current = true;
      setWebcamActive(true);
      lastSendRef.current = 0;
      animFrameRef.current = requestAnimationFrame(webcamLoop);
    } catch {
      setConnError('Camera access denied or unavailable');
    }
  }, [webcamLoop]);

  const disableWebcam = useCallback(() => {
    webcamActiveRef.current = false;
    setWebcamActive(false);
    cancelAnimationFrame(animFrameRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disableWebcam();
      clearTimeout(debounceRef.current);
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    };
  }, [disableWebcam]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--color-bg-darkest)' }}>

      {/* ── Top banner ────────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-4 px-5 shrink-0"
        style={{ height: 52, borderBottom: 'var(--border-default)', background: 'var(--color-bg-elevated)' }}
      >
        <div className="flex items-center gap-2">
          <Zap size={12} style={{ color: 'var(--color-accent)' }} />
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-accent)' }}>Beta</span>
          <span className="text-xs" style={{ color: 'var(--color-white-muted)' }}>
            Realtime generation is in beta — daily usage is capped at $10.
          </span>
        </div>

        <div className="flex items-center gap-3 ml-auto shrink-0">
          {isCapExceeded ? (
            <span className="text-xs font-medium" style={{ color: '#f87171' }}>
              Daily limit reached · resets at midnight UTC
            </span>
          ) : (
            <span className="text-xs tabular-nums" style={{ color: 'var(--color-white-muted)' }}>
              ${usage.costUsd.toFixed(4)} / $10.00
            </span>
          )}
          <div style={{ width: 120, height: 6, borderRadius: 3, background: 'var(--color-bg-surface)', overflow: 'hidden', flexShrink: 0 }}>
            <div
              style={{
                height: '100%',
                width: `${usagePct}%`,
                borderRadius: 3,
                background: isCapExceeded ? '#ef4444' : usagePct > 80 ? '#f59e0b' : 'var(--color-accent)',
                transition: 'width 0.4s ease-out',
              }}
            />
          </div>
        </div>
      </div>

      {/* ── Split view ────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left: Drawing canvas or webcam feed */}
        <div
          ref={leftContainerRef}
          className="flex-1 flex items-center justify-center overflow-hidden"
          style={{ borderRight: 'var(--border-default)', padding: 16 }}
        >
          {webcamActive ? (
            <div style={{ position: 'relative', width: canvasDisplay.w, height: canvasDisplay.h, flexShrink: 0 }}>
              <video
                ref={videoRef}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', borderRadius: 4 }}
                playsInline
                muted
              />
              <div
                style={{
                  position: 'absolute', top: 8, left: 8,
                  background: '#ef4444', borderRadius: 4,
                  padding: '2px 8px', fontSize: 10, fontWeight: 700,
                  color: '#fff', letterSpacing: '0.05em',
                }}
              >
                LIVE
              </div>
            </div>
          ) : (
            <DrawingCanvas
              ref={canvasHandle}
              imageSize={IMAGE_SIZES[quality]}
              activeTool={activeTool}
              brushColor={brushColor}
              brushSize={brushSize}
              eraserSize={eraserSize}
              onStrokeEnd={handleStrokeEnd}
              pendingImage={pendingImage}
              onImagePlaced={handleImagePlaced}
              disabled={isCapExceeded}
              wrapperStyle={{ width: canvasDisplay.w, height: canvasDisplay.h }}
            />
          )}
        </div>

        {/* Right: AI preview */}
        <div
          className="flex-1 flex items-center justify-center overflow-hidden"
          style={{ padding: 16 }}
        >
          {connError ? (
            <div
              className="flex flex-col items-center gap-3 rounded-xl p-6 text-center"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', maxWidth: 320 }}
            >
              <p className="text-xs font-medium" style={{ color: '#fca5a5' }}>{connError}</p>
              <button
                onClick={() => setConnError(null)}
                className="text-xs px-3 py-1.5 rounded-lg"
                style={{ background: 'rgba(239,68,68,0.2)', color: '#fca5a5' }}
              >
                Dismiss
              </button>
            </div>
          ) : (
            <div style={{ position: 'relative', width: canvasDisplay.w, height: canvasDisplay.h, flexShrink: 0 }}>
              {resultUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={resultUrl}
                  alt="Generated"
                  style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', borderRadius: 4 }}
                />
              ) : (
                <div
                  style={{
                    width: '100%', height: '100%',
                    background: 'var(--color-bg-surface)', borderRadius: 8,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
                  }}
                >
                  <Zap size={28} style={{ color: 'var(--color-white-muted)', opacity: 0.3 }} />
                  <p className="text-xs text-center px-6" style={{ color: 'var(--color-white-muted)' }}>
                    {webcamActive ? 'Point your camera to see live AI generation' : 'Draw on the canvas to see live generations'}
                  </p>
                </div>
              )}

              {isGenerating && (
                <div
                  style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(0,0,0,0.25)', borderRadius: 4,
                  }}
                >
                  <div
                    className="animate-spin"
                    style={{
                      width: 22, height: 22, borderRadius: '50%',
                      border: '2.5px solid rgba(255,255,255,0.2)',
                      borderTopColor: '#fff',
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom toolbar ─────────────────────────────────────────────────── */}
      <div className="shrink-0" style={{ borderTop: 'var(--border-default)', background: 'var(--color-bg-elevated)' }}>

        {/* Row 1: Drawing tools */}
        <div className="flex items-center gap-1 px-4" style={{ height: 44, borderBottom: 'var(--border-default)' }}>

          {/* Brush */}
          <div
            className="relative"
            onMouseEnter={() => { if (!webcamActive) setOpenPopover('brush'); }}
            onMouseLeave={() => setOpenPopover(null)}
          >
            <button
              onClick={() => { if (!webcamActive) setActiveTool('brush'); }}
              disabled={webcamActive}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-30"
              style={{
                background: activeTool === 'brush' && !webcamActive ? 'rgba(255,255,255,0.1)' : 'transparent',
                color: activeTool === 'brush' && !webcamActive ? 'var(--color-white)' : 'var(--color-white-muted)',
                border: activeTool === 'brush' && !webcamActive ? 'var(--border-default)' : '1px solid transparent',
              }}
            >
              <Brush size={13} />
              Brush
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: brushColor, border: '1.5px solid rgba(255,255,255,0.25)', flexShrink: 0, display: 'inline-block' }} />
            </button>

            {openPopover === 'brush' && !webcamActive && (
              <div
                className="absolute bottom-full mb-2 left-0 rounded-xl p-3"
                style={{ background: 'var(--color-bg-elevated)', border: 'var(--border-default)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', minWidth: 204, zIndex: 60 }}
              >
                <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--color-white-muted)' }}>Size — {brushSize}px</p>
                <input type="range" min={1} max={60} value={brushSize} onChange={e => setBrushSize(+e.target.value)} className="w-full mb-3" style={{ accentColor: 'var(--color-accent)' }} />
                <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--color-white-muted)' }}>Color</p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {BRUSH_COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setBrushColor(c)}
                      style={{ width: 18, height: 18, borderRadius: '50%', background: c, flexShrink: 0, border: brushColor === c ? '2px solid var(--color-accent)' : '1.5px solid rgba(255,255,255,0.2)', cursor: 'pointer' }}
                    />
                  ))}
                </div>
                <input type="color" value={brushColor} onChange={e => setBrushColor(e.target.value)} style={{ width: '100%', height: 24, cursor: 'pointer', borderRadius: 4, border: 'none' }} />
              </div>
            )}
          </div>

          {/* Eraser */}
          <div
            className="relative"
            onMouseEnter={() => { if (!webcamActive) setOpenPopover('eraser'); }}
            onMouseLeave={() => setOpenPopover(null)}
          >
            <button
              onClick={() => { if (!webcamActive) setActiveTool('eraser'); }}
              disabled={webcamActive}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-30"
              style={{
                background: activeTool === 'eraser' && !webcamActive ? 'rgba(255,255,255,0.1)' : 'transparent',
                color: activeTool === 'eraser' && !webcamActive ? 'var(--color-white)' : 'var(--color-white-muted)',
                border: activeTool === 'eraser' && !webcamActive ? 'var(--border-default)' : '1px solid transparent',
              }}
            >
              <Eraser size={13} />
              Eraser
            </button>

            {openPopover === 'eraser' && !webcamActive && (
              <div
                className="absolute bottom-full mb-2 left-0 rounded-xl p-3"
                style={{ background: 'var(--color-bg-elevated)', border: 'var(--border-default)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', minWidth: 180, zIndex: 60 }}
              >
                <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--color-white-muted)' }}>Size — {eraserSize}px</p>
                <input type="range" min={5} max={100} value={eraserSize} onChange={e => setEraserSize(+e.target.value)} className="w-full" style={{ accentColor: 'var(--color-accent)' }} />
              </div>
            )}
          </div>

          {/* Upload */}
          <button
            onClick={() => uploadInputRef.current?.click()}
            disabled={webcamActive}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-white/5 disabled:opacity-30"
            style={{ color: 'var(--color-white-muted)', border: '1px solid transparent' }}
          >
            <Upload size={13} />
            Upload
          </button>
          <input ref={uploadInputRef} type="file" accept="image/*" className="hidden" onChange={handleUploadChange} />

          {/* Webcam toggle */}
          <button
            onClick={webcamActive ? disableWebcam : enableWebcam}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{
              background: webcamActive ? 'rgba(239,68,68,0.15)' : 'transparent',
              color: webcamActive ? '#f87171' : 'var(--color-white-muted)',
              border: webcamActive ? '1px solid rgba(239,68,68,0.3)' : '1px solid transparent',
            }}
          >
            <Camera size={13} />
            {webcamActive ? 'Stop Camera' : 'Camera'}
          </button>

          <div className="flex-1" />

          {/* Clear */}
          <button
            onClick={() => canvasHandle.current?.clear()}
            disabled={webcamActive}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-white/5 disabled:opacity-30"
            style={{ color: 'var(--color-white-muted)' }}
          >
            <Trash2 size={13} />
            Clear
          </button>
        </div>

        {/* Row 2: Prompt + quality toggle */}
        <div className="flex items-center gap-3 px-4 py-2.5">
          <input
            type="text"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder={isCapExceeded ? 'Daily limit reached — resets at midnight UTC' : 'Describe what to generate…'}
            disabled={isCapExceeded}
            className="flex-1 px-3 py-2 rounded-lg text-sm outline-none disabled:opacity-40"
            style={{ background: 'var(--color-bg-surface)', border: 'var(--border-default)', color: 'var(--color-white)' }}
          />

          <div className="flex rounded-lg overflow-hidden shrink-0" style={{ border: 'var(--border-default)' }}>
            {(['standard', 'hd'] as Quality[]).map((q, i) => (
              <button
                key={q}
                onClick={() => setQuality(q)}
                className="px-3 py-2 text-xs font-medium transition-colors"
                style={{
                  background: quality === q ? 'rgba(255,255,255,0.1)' : 'transparent',
                  color: quality === q ? 'var(--color-white)' : 'var(--color-white-muted)',
                  borderRight: i === 0 ? 'var(--border-default)' : 'none',
                }}
              >
                {q === 'standard' ? 'Standard' : 'HD'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Hidden canvas for webcam frame capture */}
      <canvas ref={captureCanvasRef} style={{ display: 'none' }} />
    </div>
  );
}
