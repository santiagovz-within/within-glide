'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fal } from '@fal-ai/client';
import { DrawingCanvas, type DrawingCanvasHandle } from './DrawingCanvas';
import { Brush, Camera, Eraser, Upload, Trash2, Zap } from 'lucide-react';

// ─── Constants ─────────────────────────────────────────────────────────────────

const CAP_USD = 10;
const COMPUTE_SECONDS_ESTIMATE = 2; // estimate per request for cost tracking

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

// ─── Shared button style ───────────────────────────────────────────────────────

function pillStyle(active: boolean, disabled = false, danger = false): React.CSSProperties {
  let bg = 'transparent';
  let color = 'var(--color-white-muted)';
  let border = '1px solid transparent';

  if (disabled) {
    return {
      display: 'flex', alignItems: 'center', gap: 5,
      padding: '7px 13px', borderRadius: 999,
      fontSize: 11, fontWeight: 700, letterSpacing: '0.065em',
      whiteSpace: 'nowrap', cursor: 'default',
      opacity: 0.28, border, background: bg, color,
      transition: 'all 0.15s',
    };
  }

  if (danger) {
    bg = 'rgba(239,68,68,0.15)';
    color = '#f87171';
    border = '1px solid rgba(239,68,68,0.3)';
  } else if (active) {
    bg = 'rgba(255,255,255,0.12)';
    color = 'var(--color-white)';
    border = '1px solid rgba(255,255,255,0.14)';
  }

  return {
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '7px 13px', borderRadius: 999,
    fontSize: 11, fontWeight: 700, letterSpacing: '0.065em',
    whiteSpace: 'nowrap', cursor: 'pointer',
    background: bg, color, border,
    transition: 'all 0.15s',
  };
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function RealtimePage() {
  const [activeTool,  setActiveTool]  = useState<'brush' | 'eraser'>('brush');
  const [brushColor,  setBrushColor]  = useState('#000000');
  const [brushSize,   setBrushSize]   = useState(10);
  const [eraserSize,  setEraserSize]  = useState(20);
  const [openPopover, setOpenPopover] = useState<'brush' | 'eraser' | null>(null);

  const [prompt,       setPrompt]       = useState('');
  const [quality,      setQuality]      = useState<Quality>('standard');
  const [resultUrl,    setResultUrl]    = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [connError,    setConnError]    = useState<string | null>(null);

  const [usage, setUsage] = useState<UsageState>({ costUsd: 0, requestCount: 0 });

  const [pendingImage, setPendingImage] = useState<HTMLImageElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const [webcamActive, setWebcamActive] = useState(false);
  const webcamActiveRef  = useRef(false);
  const videoRef         = useRef<HTMLVideoElement>(null);
  const streamRef        = useRef<MediaStream | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef     = useRef<number>(0);
  const lastSendRef      = useRef<number>(0);

  const canvasHandle      = useRef<DrawingCanvasHandle>(null);
  const connectionRef     = useRef<ReturnType<typeof fal.realtime.connect<FluxInput, FluxResult>> | null>(null);
  const debounceRef       = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hoverTimeoutRef   = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastDataUriRef    = useRef<string>('');
  const resultUrlRef      = useRef<string | null>(null);
  const leftContainerRef  = useRef<HTMLDivElement>(null);
  const qualityRef        = useRef<Quality>('standard');
  const promptRef         = useRef('');

  useEffect(() => { qualityRef.current = quality; }, [quality]);
  useEffect(() => { promptRef.current = prompt; }, [prompt]);

  const isCapExceeded = usage.costUsd >= CAP_USD;
  const usagePct      = Math.min(100, (usage.costUsd / CAP_USD) * 100);

  const [canvasDisplay, setCanvasDisplay] = useState({ w: 512, h: 512 });

  useEffect(() => {
    fetch('/api/realtime/usage')
      .then(r => r.json())
      .then(d => setUsage({ costUsd: d.costUsd ?? 0, requestCount: d.requestCount ?? 0 }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const el = leftContainerRef.current;
    if (!el) return;
    const { width: pw, height: ph } = IMAGE_SIZES[quality];

    const compute = () => {
      const cw = el.clientWidth  - 32;
      const ch = el.clientHeight - 32 - 108; // 32 normal pad + 108 for floating toolbar
      if (cw <= 0 || ch <= 0) return;
      const scale = Math.min(cw / pw, ch / ph, 1);
      setCanvasDisplay({ w: Math.floor(pw * scale), h: Math.floor(ph * scale) });
    };

    const ro = new ResizeObserver(compute);
    ro.observe(el);
    compute();
    return () => ro.disconnect();
  }, [quality]);

  const setAndTrackResultUrl = useCallback((url: string) => {
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    resultUrlRef.current = url;
    setResultUrl(url);
  }, []);

  const tokenProvider = useCallback(async (app: string) => {
    const res  = await fetch(`/api/fal/realtime-token?app=${encodeURIComponent(app)}`);
    const data = await res.json();
    return data.token as string;
  }, []);

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
            // Sync usage from server — single source of truth, no client-side drift
            fetch('/api/realtime/usage', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ computeSeconds: COMPUTE_SECONDS_ESTIMATE }),
            })
              .then(r => r.json())
              .then(d => {
                if (typeof d.costUsd === 'number') {
                  setUsage({ costUsd: d.costUsd, requestCount: d.requestCount ?? 0 });
                }
              })
              .catch(() => {});
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
    return () => { conn.close(); connectionRef.current = null; };
  }, [tokenProvider, setAndTrackResultUrl]);

  // Unified debounce: called from both stroke end and prompt typing.
  // Sends only after 600ms of no drawing AND no typing.
  const scheduleSend = useCallback((dataUri?: string) => {
    if (isCapExceeded || webcamActiveRef.current) return;
    if (dataUri) lastDataUriRef.current = dataUri;
    if (!lastDataUriRef.current) return; // nothing drawn yet
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const uri = lastDataUriRef.current;
      if (!uri || !connectionRef.current) return;
      setIsGenerating(true);
      connectionRef.current.send({
        prompt:              promptRef.current,
        image_url:           uri,
        num_inference_steps: 3,
        image_size:          FAL_IMAGE_SIZES[qualityRef.current],
      });
    }, 600);
  }, [isCapExceeded]);

  const handleStrokeEnd = useCallback((dataUri: string) => {
    if (dataUri) scheduleSend(dataUri);
  }, [scheduleSend]);

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

  // Popover hover with delay so mouse can travel from button to popover
  const openHover = useCallback((which: 'brush' | 'eraser') => {
    clearTimeout(hoverTimeoutRef.current);
    if (!webcamActiveRef.current) setOpenPopover(which);
  }, []);

  const closeHover = useCallback(() => {
    hoverTimeoutRef.current = setTimeout(() => setOpenPopover(null), 160);
  }, []);

  const keepHover = useCallback(() => {
    clearTimeout(hoverTimeoutRef.current);
  }, []);

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
    const side = Math.min(vw, vh);
    ctx.drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.85);
  }, []);

  const webcamLoop = useCallback(() => {
    if (!webcamActiveRef.current) return;
    const now = Date.now();
    if (now - lastSendRef.current >= 167) { // ~6 fps
      const frame = captureFrame();
      if (frame && connectionRef.current) {
        lastSendRef.current = now;
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
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      streamRef.current = stream;
      // videoRef is always mounted — safe to access synchronously
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
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

  useEffect(() => {
    return () => {
      disableWebcam();
      clearTimeout(debounceRef.current);
      clearTimeout(hoverTimeoutRef.current);
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
            <span className="text-xs font-medium" style={{ color: '#f87171' }}>Daily limit reached · resets at midnight UTC</span>
          ) : (
            <span className="text-xs tabular-nums" style={{ color: 'var(--color-white-muted)' }}>${usage.costUsd.toFixed(4)} / $10.00</span>
          )}
          <div style={{ width: 120, height: 6, borderRadius: 3, background: 'var(--color-bg-surface)', overflow: 'hidden', flexShrink: 0 }}>
            <div style={{ height: '100%', width: `${usagePct}%`, borderRadius: 3, background: isCapExceeded ? '#ef4444' : usagePct > 80 ? '#f59e0b' : 'var(--color-accent)', transition: 'width 0.4s ease-out' }} />
          </div>
        </div>
      </div>

      {/* ── Main area with floating toolbar ──────────────────────────────── */}
      <div className="flex-1 relative overflow-hidden">

        {/* Split view */}
        <div className="flex h-full">

          {/* Left: canvas / webcam */}
          <div
            ref={leftContainerRef}
            className="flex-1 flex items-center justify-center overflow-hidden"
            style={{ borderRight: 'var(--border-default)', padding: 16 }}
          >
            <div style={{ position: 'relative', width: canvasDisplay.w, height: canvasDisplay.h, flexShrink: 0 }}>
              {/* Video always mounted so ref is valid before webcam activates */}
              <video
                ref={videoRef}
                style={webcamActive ? {
                  position: 'absolute', inset: 0, width: '100%', height: '100%',
                  objectFit: 'cover', display: 'block', borderRadius: 6,
                } : {
                  position: 'absolute', width: 0, height: 0, opacity: 0,
                }}
                playsInline
                muted
              />
              {webcamActive && (
                <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 10, background: '#ef4444', borderRadius: 4, padding: '2px 8px', fontSize: 10, fontWeight: 700, color: '#fff', letterSpacing: '0.05em' }}>LIVE</div>
              )}
              {!webcamActive && (
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
          </div>

          {/* Right: AI preview */}
          <div className="flex-1 flex items-center justify-center overflow-hidden" style={{ padding: 16 }}>
            {connError ? (
              <div className="flex flex-col items-center gap-3 rounded-xl p-6 text-center" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', maxWidth: 320 }}>
                <p className="text-xs font-medium" style={{ color: '#fca5a5' }}>{connError}</p>
                <button onClick={() => setConnError(null)} className="text-xs px-3 py-1.5 rounded-lg" style={{ background: 'rgba(239,68,68,0.2)', color: '#fca5a5' }}>Dismiss</button>
              </div>
            ) : (
              <div style={{ position: 'relative', width: canvasDisplay.w, height: canvasDisplay.h, flexShrink: 0 }}>
                {resultUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={resultUrl} alt="Generated" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', borderRadius: 6 }} />
                ) : (
                  <div style={{ width: '100%', height: '100%', background: 'var(--color-bg-surface)', borderRadius: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                    <Zap size={28} style={{ color: 'var(--color-white-muted)', opacity: 0.3 }} />
                    <p className="text-xs text-center px-6" style={{ color: 'var(--color-white-muted)' }}>
                      {webcamActive ? 'Point your camera to see live AI generation' : 'Draw on the canvas to see live generations'}
                    </p>
                  </div>
                )}
                {isGenerating && !webcamActive && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.25)', borderRadius: 6 }}>
                    <div className="animate-spin" style={{ width: 22, height: 22, borderRadius: '50%', border: '2.5px solid rgba(255,255,255,0.2)', borderTopColor: '#fff' }} />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Floating island toolbar ────────────────────────────────────── */}
        <div
          className="absolute bottom-5 left-1/2 -translate-x-1/2"
          style={{ zIndex: 50, width: 'min(700px, calc(100% - 40px))' }}
        >
          <div
            style={{
              borderRadius: 18,
              background: 'rgba(14,14,18,0.95)',
              backdropFilter: 'blur(28px)',
              WebkitBackdropFilter: 'blur(28px)',
              border: '1px solid rgba(255,255,255,0.09)',
              boxShadow: '0 16px 56px rgba(0,0,0,0.7), 0 3px 14px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.025)',
            }}
          >
            {/* ── Tools row ───────────────────────────────────────────────── */}
            <div className="flex items-center gap-0.5 px-2.5 pt-2.5 pb-2">

              {/* Brush */}
              <div
                className="relative"
                onMouseEnter={() => openHover('brush')}
                onMouseLeave={closeHover}
              >
                <button onClick={() => { if (!webcamActive) setActiveTool('brush'); }} style={pillStyle(activeTool === 'brush', webcamActive)}>
                  <Brush size={12} />
                  BRUSH
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: brushColor, border: '1px solid rgba(255,255,255,0.25)', flexShrink: 0, display: 'inline-block', marginLeft: 1 }} />
                </button>

                {openPopover === 'brush' && !webcamActive && (
                  <div
                    className="absolute bottom-full mb-2.5 left-0 rounded-2xl p-3.5"
                    style={{ background: 'rgba(14,14,18,0.98)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 12px 40px rgba(0,0,0,0.7)', minWidth: 212, zIndex: 70 }}
                    onMouseEnter={keepHover}
                    onMouseLeave={closeHover}
                  >
                    <p className="text-[11px] font-semibold mb-2" style={{ color: 'var(--color-white-muted)', letterSpacing: '0.05em' }}>SIZE — {brushSize}px</p>
                    <input type="range" min={1} max={60} value={brushSize} onChange={e => setBrushSize(+e.target.value)} className="w-full mb-3.5" style={{ accentColor: 'var(--color-accent)' }} />
                    <p className="text-[11px] font-semibold mb-2" style={{ color: 'var(--color-white-muted)', letterSpacing: '0.05em' }}>COLOR</p>
                    <div className="flex flex-wrap gap-1.5 mb-2.5">
                      {BRUSH_COLORS.map(c => (
                        <button key={c} onClick={() => setBrushColor(c)} style={{ width: 20, height: 20, borderRadius: '50%', background: c, flexShrink: 0, border: brushColor === c ? '2px solid var(--color-accent)' : '1.5px solid rgba(255,255,255,0.18)', cursor: 'pointer' }} />
                      ))}
                    </div>
                    <input type="color" value={brushColor} onChange={e => setBrushColor(e.target.value)} style={{ width: '100%', height: 26, cursor: 'pointer', borderRadius: 6, border: 'none' }} />
                  </div>
                )}
              </div>

              {/* Eraser */}
              <div
                className="relative"
                onMouseEnter={() => openHover('eraser')}
                onMouseLeave={closeHover}
              >
                <button onClick={() => { if (!webcamActive) setActiveTool('eraser'); }} style={pillStyle(activeTool === 'eraser', webcamActive)}>
                  <Eraser size={12} />
                  ERASER
                </button>

                {openPopover === 'eraser' && !webcamActive && (
                  <div
                    className="absolute bottom-full mb-2.5 left-0 rounded-2xl p-3.5"
                    style={{ background: 'rgba(14,14,18,0.98)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 12px 40px rgba(0,0,0,0.7)', minWidth: 188, zIndex: 70 }}
                    onMouseEnter={keepHover}
                    onMouseLeave={closeHover}
                  >
                    <p className="text-[11px] font-semibold mb-2" style={{ color: 'var(--color-white-muted)', letterSpacing: '0.05em' }}>SIZE — {eraserSize}px</p>
                    <input type="range" min={5} max={100} value={eraserSize} onChange={e => setEraserSize(+e.target.value)} className="w-full" style={{ accentColor: 'var(--color-accent)' }} />
                  </div>
                )}
              </div>

              {/* Upload */}
              <button
                onClick={() => uploadInputRef.current?.click()}
                style={pillStyle(false, webcamActive)}
                onMouseEnter={e => { if (!webcamActive) e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                <Upload size={12} />
                UPLOAD
              </button>
              <input ref={uploadInputRef} type="file" accept="image/*" className="hidden" onChange={handleUploadChange} />

              {/* Camera */}
              <button
                onClick={webcamActive ? disableWebcam : enableWebcam}
                style={pillStyle(false, false, webcamActive)}
                onMouseEnter={e => { if (!webcamActive) e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; }}
                onMouseLeave={e => { if (!webcamActive) e.currentTarget.style.background = 'transparent'; }}
              >
                <Camera size={12} />
                {webcamActive ? 'STOP CAMERA' : 'LIVE CAMERA'}
              </button>

              <div style={{ flex: 1 }} />

              {/* Clear */}
              <button
                onClick={() => canvasHandle.current?.clear()}
                style={pillStyle(false, webcamActive)}
                onMouseEnter={e => { if (!webcamActive) e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                <Trash2 size={12} />
                CLEAR
              </button>
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '0 12px' }} />

            {/* ── Prompt row ──────────────────────────────────────────────── */}
            <div className="flex items-center gap-2 px-3.5 py-2.5">
              <input
                type="text"
                value={prompt}
                onChange={e => { setPrompt(e.target.value); scheduleSend(); }}
                placeholder={isCapExceeded ? 'Daily limit reached — resets at midnight UTC' : 'Describe what to generate…'}
                disabled={isCapExceeded}
                className="flex-1 text-sm outline-none bg-transparent disabled:opacity-40"
                style={{ border: 'none', color: 'var(--color-white)', padding: '2px 0' }}
              />

              {/* Quality toggle */}
              <div className="flex shrink-0 rounded-full overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
                {(['standard', 'hd'] as Quality[]).map((q, i) => (
                  <button
                    key={q}
                    onClick={() => setQuality(q)}
                    style={{
                      padding: '5px 12px',
                      fontSize: 11, fontWeight: 700, letterSpacing: '0.065em',
                      background: quality === q ? 'rgba(255,255,255,0.12)' : 'transparent',
                      color: quality === q ? 'var(--color-white)' : 'var(--color-white-muted)',
                      borderRight: i === 0 ? '1px solid rgba(255,255,255,0.1)' : 'none',
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}
                  >
                    {q === 'standard' ? 'SD' : 'HD'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <canvas ref={captureCanvasRef} style={{ display: 'none' }} />
    </div>
  );
}
