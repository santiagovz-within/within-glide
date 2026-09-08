'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStoreApi } from '@xyflow/react';
import { ChevronDown, Lock } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import glassStyles from './ImageGenerationGlass.module.css';

interface NodeSelectProps {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  leadingIcon?: React.ReactNode;
  optionIcon?: (option: string) => React.ReactNode;
  appearance?: 'default' | 'imageGenerationGlass';
  standalone?: boolean;
  size?: 'default' | 'large';
  placement?: 'top' | 'bottom';
  label?: string;
  locked?: boolean;
}

interface DropdownPosition {
  top: number;
  left: number;
  width: number;
  scale: number;
  triggerTop: number;
  viewportHeight: number;
}

function measureDropdown(trigger: HTMLButtonElement): DropdownPosition {
  const rect = trigger.getBoundingClientRect();
  const scale = trigger.offsetWidth > 0 ? rect.width / trigger.offsetWidth : 1;
  return {
    top: rect.bottom + 3 * scale,
    left: rect.left,
    width: trigger.offsetWidth,
    scale,
    triggerTop: rect.top,
    viewportHeight: window.innerHeight,
  };
}

export function NodeSelect(props: NodeSelectProps) {
  return props.standalone ? <NodeSelectControl {...props} /> : <CanvasNodeSelect {...props} />;
}

function CanvasNodeSelect(props: NodeSelectProps) {
  const reactFlowStore = useStoreApi();
  return <NodeSelectControl {...props} reactFlowStore={reactFlowStore} />;
}

function NodeSelectControl({
  options, value, onChange, leadingIcon, optionIcon,
  appearance = 'imageGenerationGlass', locked = false,
  placement = 'bottom', label, size = 'default', reactFlowStore,
}: NodeSelectProps & { reactFlowStore?: ReturnType<typeof useStoreApi> }) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pos, setPos] = useState<DropdownPosition>({ top: 0, left: 0, width: 0, scale: 1, triggerTop: 0, viewportHeight: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isImageGenerationGlass = appearance === 'imageGenerationGlass';

  function openDropdown(e: React.MouseEvent) {
    e.stopPropagation();
    if (locked) return;
    if (!triggerRef.current) return;
    setPos(measureDropdown(triggerRef.current));
    setOpen((o) => !o);
  }

  useLayoutEffect(() => {
    if (!open) return;
    dropdownRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus({ preventScroll: true });
    let frameId: number | undefined;
    const syncPosition = () => {
      if (triggerRef.current) setPos(measureDropdown(triggerRef.current));
    };
    const scheduleSync = () => {
      if (frameId !== undefined) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(syncPosition);
    };
    const unsubscribe = reactFlowStore?.subscribe(scheduleSync);
    window.addEventListener('resize', scheduleSync);
    window.addEventListener('scroll', scheduleSync, true);
    return () => {
      unsubscribe?.();
      window.removeEventListener('resize', scheduleSync);
      window.removeEventListener('scroll', scheduleSync, true);
      if (frameId !== undefined) cancelAnimationFrame(frameId);
    };
  }, [open, reactFlowStore]);

  useEffect(() => {
    if (!open) return;
    function onOutsideDown(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onOutsideDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onOutsideDown, true);
    };
  }, [open]);

  const triggerContent = (
    <>
      <span
        className={cn(isImageGenerationGlass && glassStyles.selectContent)}
        style={isImageGenerationGlass ? undefined : { display: 'flex', flex: 1, minWidth: 0 }}
      >
        {leadingIcon}
        <span
          className={cn(isImageGenerationGlass && glassStyles.selectValue)}
          style={isImageGenerationGlass ? undefined : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {value}
        </span>
      </span>
      {locked ? (
        <Lock
          size={isImageGenerationGlass ? 12 : 18}
          className={cn(isImageGenerationGlass && glassStyles.lockIcon)}
          aria-hidden
        />
      ) : (
        <ChevronDown
          size={isImageGenerationGlass ? 14 : 20}
          className={cn(isImageGenerationGlass && glassStyles.chevron)}
          style={{
            opacity: isImageGenerationGlass ? 1 : 0.6,
            flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s',
          }}
        />
      )}
    </>
  );

  const dropdownOptions = options.map((opt) => (
    <button
      key={opt}
      role="option"
      aria-selected={opt === value}
      className={cn(
        'nodrag w-full flex items-center gap-1.5 px-2 py-1.5 text-xs',
        isImageGenerationGlass && glassStyles.dropdownOption,
      )}
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
      onClick={() => { onChange(opt); setOpen(false); triggerRef.current?.focus(); }}
    >
      {optionIcon?.(opt)}
      {opt}
    </button>
  ));

  return (
    <div className="nodrag" style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        title={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'nodrag',
          size === 'large' && glassStyles.largeControls,
          isImageGenerationGlass
            ? [glassStyles.glassSurface, glassStyles.selectTrigger, locked && glassStyles.selectTriggerLocked]
            : 'w-full h-full flex items-center gap-1.5 px-2 py-1.5 text-xs',
        )}
        style={isImageGenerationGlass ? undefined : {
          background: 'var(--color-bg-surface)',
          color: 'var(--color-white)',
          border: 'none',
          borderRadius: 11,
          cursor: 'pointer',
          textAlign: 'left',
          outline: 'none',
          lineHeight: 1.4,
        }}
        disabled={locked}
        aria-label={locked ? `${value}, locked` : label}
        onClick={openDropdown}
      >
        {isImageGenerationGlass ? (
          <span className={cn(glassStyles.glassContent, glassStyles.selectTriggerContent)}>
            {triggerContent}
          </span>
        ) : triggerContent}
      </button>

      {open && !locked && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          role="listbox"
          aria-label={label}
          onKeyDown={event => {
            const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'));
            const index = options.indexOf(document.activeElement as HTMLButtonElement);
            let nextIndex: number;
            if (event.key === 'ArrowDown') nextIndex = (index + 1) % options.length;
            else if (event.key === 'ArrowUp') nextIndex = (index - 1 + options.length) % options.length;
            else if (event.key === 'Home') nextIndex = 0;
            else if (event.key === 'End') nextIndex = options.length - 1;
            else if (event.key === 'Tab') { setOpen(false); triggerRef.current?.focus(); return; }
            else return;
            event.preventDefault();
            options[nextIndex]?.focus();
          }}
          className={cn(
            'nodrag',
            size === 'large' && glassStyles.largeControls,
            isImageGenerationGlass && glassStyles.glassSurface,
            isImageGenerationGlass && glassStyles.dropdownMenu,
          )}
          style={{
            position: 'fixed',
            top: placement === 'top' ? undefined : pos.top,
            bottom: placement === 'top' ? pos.viewportHeight - pos.triggerTop + 3 : undefined,
            maxHeight: placement === 'top' ? Math.max(80, pos.triggerTop - 16) : undefined,
            left: pos.left,
            width: pos.width,
            transform: `scale(${pos.scale})`,
            transformOrigin: placement === 'top' ? 'bottom left' : 'top left',
            background: isImageGenerationGlass ? undefined : 'var(--color-bg-surface)',
            borderRadius: 11,
            border: isImageGenerationGlass ? 'none' : '1px solid rgba(255,255,255,0.1)',
            overflow: 'auto',
            zIndex: 99999,
          }}
        >
          {isImageGenerationGlass ? (
            <div className={glassStyles.glassContent}>{dropdownOptions}</div>
          ) : dropdownOptions}
        </div>,
        document.body
      )}
    </div>
  );
}
