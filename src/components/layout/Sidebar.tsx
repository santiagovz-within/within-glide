'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  Workflow,
  ImageIcon,
  Music2,
  Grid3x3,
  Settings,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';

const NAV_ITEMS = [
  { label: 'Canvas Flow', icon: Workflow, href: '/dashboard/canvas-flow' },
  { label: 'Image & Video', icon: ImageIcon, href: '/dashboard/image-video' },
  { label: 'Gallery', icon: Grid3x3, href: '/dashboard/gallery' },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  function handleJamBox() {
    window.open('https://jambox-one.vercel.app/', '_blank', 'noopener,noreferrer');
  }

  return (
    <aside
      className="relative flex flex-col h-full transition-all duration-200 shrink-0"
      style={{
        width: collapsed ? '64px' : '220px',
        background: 'var(--color-bg-darkest)',
        borderRight: 'var(--border-default)',
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center gap-3 px-4 py-5 overflow-hidden"
        style={{ borderBottom: 'var(--border-default)' }}
      >
        <div
          className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
          style={{ background: 'var(--color-accent)' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-white">
            <path d="M3 6l6-3 6 3 6-3v12l-6 3-6-3-6 3V6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M9 3v12M15 6v12" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </div>
        {!collapsed && (
          <span className="text-sm font-semibold whitespace-nowrap" style={{ color: 'var(--color-white)' }}>
            FlowCanvas
          </span>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-2 py-4 space-y-1 overflow-hidden">
        {NAV_ITEMS.map(({ label, icon: Icon, href }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 group',
                active ? 'bg-white/10' : 'hover:bg-white/5'
              )}
            >
              <Icon
                size={18}
                className="shrink-0 transition-colors"
                style={{ color: active ? 'var(--color-white)' : 'var(--color-white-muted)' }}
              />
              {!collapsed && (
                <span
                  className="text-sm whitespace-nowrap transition-colors"
                  style={{ color: active ? 'var(--color-white)' : 'var(--color-white-muted)' }}
                >
                  {label}
                </span>
              )}
              {active && (
                <div
                  className="absolute left-0 w-0.5 h-6 rounded-r-full"
                  style={{ background: 'var(--color-accent)' }}
                />
              )}
            </Link>
          );
        })}

        {/* JamBox (external link) */}
        <button
          onClick={handleJamBox}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 w-full hover:bg-white/5"
        >
          <Music2
            size={18}
            className="shrink-0"
            style={{ color: 'var(--color-white-muted)' }}
          />
          {!collapsed && (
            <span
              className="text-sm whitespace-nowrap"
              style={{ color: 'var(--color-white-muted)' }}
            >
              JamBox
            </span>
          )}
        </button>
      </nav>

      {/* Bottom section */}
      <div className="px-2 pb-4 space-y-1" style={{ borderTop: 'var(--border-default)', paddingTop: '12px' }}>
        <Link
          href="/dashboard/settings"
          className={cn(
            'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150',
            pathname === '/dashboard/settings' ? 'bg-white/10' : 'hover:bg-white/5'
          )}
        >
          <Settings
            size={18}
            className="shrink-0"
            style={{ color: pathname === '/dashboard/settings' ? 'var(--color-white)' : 'var(--color-white-muted)' }}
          />
          {!collapsed && (
            <span
              className="text-sm whitespace-nowrap"
              style={{ color: pathname === '/dashboard/settings' ? 'var(--color-white)' : 'var(--color-white-muted)' }}
            >
              Settings
            </span>
          )}
        </Link>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 w-full hover:bg-white/5"
        >
          {collapsed ? (
            <ChevronRight size={18} style={{ color: 'var(--color-white-muted)' }} />
          ) : (
            <>
              <ChevronLeft size={18} style={{ color: 'var(--color-white-muted)' }} />
              <span className="text-sm" style={{ color: 'var(--color-white-muted)' }}>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
