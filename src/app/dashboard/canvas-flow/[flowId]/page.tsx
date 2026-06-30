'use client';

import { useEffect, useCallback, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ReactFlowProvider, type Node } from '@xyflow/react';
import { FlowCanvas } from '@/components/canvas/FlowCanvas';
import { TopBar } from '@/components/layout/TopBar';
import { useFlowStore } from '@/lib/stores/flowStore';
import { createClient } from '@/lib/supabase/client';
import { AUTOSAVE_DEBOUNCE_MS } from '@/lib/utils/constants';
import type { NodeData, ImageGenNodeData, UpscaleNodeData, ImageInputNodeData } from '@/types';
import { compressToThumbnailDataUrl } from '@/lib/utils/imageProcessing';

/** Returns the first available generated/uploaded image URL from the canvas nodes */
function extractThumbnail(nodes: Node<NodeData>[]): string | null {
  for (const node of nodes) {
    if (node.type === 'imageGenNode') {
      const url = (node.data as ImageGenNodeData).generatedImages?.[0];
      if (url) return url;
    }
    if (node.type === 'upscaleNode') {
      const url = (node.data as UpscaleNodeData).outputImageUrl;
      if (url) return url;
    }
    if (node.type === 'imageInputNode') {
      const url = (node.data as ImageInputNodeData).imageUrl;
      if (url) return url;
    }
  }
  return null;
}

export default function FlowEditorPage() {
  const params = useParams<{ flowId: string }>();
  const { flowId } = params;
  const router = useRouter();
  const {
    setCurrentFlow, nodes, edges,
    isDirty, setDirty, setSaving, setLastSaved, currentFlow,
  } = useFlowStore();
  const supabase = createClient();
  const [isTestUser, setIsTestUser] = useState(false);
  const [isOwner, setIsOwner] = useState(true);
  const [isShared, setIsShared] = useState(false);
  const [isForking, setIsForking] = useState(false);

  const loadFlow = useCallback(async () => {
    const res = await fetch(`/api/flows/${flowId}`);
    if (!res.ok) return;
    const { data, isOwner: owner } = await res.json();
    if (data) {
      setCurrentFlow(data);
      setIsOwner(owner ?? true);
      setIsShared(data.is_shared ?? false);
    }
  }, [flowId, setCurrentFlow]);

  async function handleToggleShare() {
    const next = !isShared;
    setIsShared(next);
    await fetch(`/api/flows/${flowId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_shared: next }),
    });
  }

  async function handleFork() {
    setIsForking(true);
    try {
      const res = await fetch(`/api/flows/${flowId}/fork`, { method: 'POST' });
      if (!res.ok) return;
      const { flowId: forkedId } = await res.json();
      router.push(`/dashboard/canvas-flow/${forkedId}`);
    } finally {
      setIsForking(false);
    }
  }

  useEffect(() => {
    async function checkTestUser() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_test_user')
        .eq('id', user.id)
        .single();
      if (profile?.is_test_user) setIsTestUser(true);
    }
    checkTestUser();
  }, [supabase]);

  useEffect(() => {
    loadFlow();
    return () => setCurrentFlow(null);
  }, [loadFlow, setCurrentFlow]);

  // Auto-save debounced — also extracts and saves thumbnail
  useEffect(() => {
    if (!isDirty || !currentFlow || !isOwner) return;
    const timer = setTimeout(async () => {
      setSaving(true);
      try {
        const rawThumb = extractThumbnail(nodes);
        let thumbnail: string | null = null;
        if (rawThumb) {
          const dataUrl = await compressToThumbnailDataUrl(rawThumb);
          if (dataUrl) {
            const res = await fetch('/api/thumbnails/upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ dataUrl, flowId }),
            });
            if (res.ok) {
              const { ref } = await res.json();
              thumbnail = ref ?? null;
            }
          }
        }
        await supabase
          .from('flows')
          .update({
            flow_data: {
              nodes: nodes.map((n) => ({
                id: n.id,
                type: n.type,
                position: n.position,
                data: n.data,
                parentId: n.parentId,
                style: n.style,
              })),
              edges,
              viewport: { x: 0, y: 0, zoom: 1 },
            },
            ...(thumbnail ? { thumbnail_url: thumbnail } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq('id', flowId);
        setDirty(false);
        setLastSaved(new Date());
      } finally {
        setSaving(false);
      }
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [isDirty, nodes, edges, flowId, currentFlow, supabase, setDirty, setSaving, setLastSaved]);

  // Ctrl+S
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (isDirty) setDirty(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isDirty, setDirty]);

  return (
    <ReactFlowProvider>
      <div className="relative w-full h-full">
        <TopBar
          flowId={flowId}
          isOwner={isOwner}
          isShared={isShared}
          onToggleShare={handleToggleShare}
        />

        {/* Banner shown to non-owners viewing a shared flow */}
        {!isOwner && (
          <div
            className="absolute top-20 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm pointer-events-auto"
            style={{
              background: 'var(--color-bg-elevated)',
              border: 'var(--border-default)',
              boxShadow: 'var(--shadow-node)',
            }}
          >
            <span style={{ color: 'var(--color-white-muted)' }}>
              Viewing <span style={{ color: 'var(--color-white)' }}>{currentFlow?.title ?? 'this flow'}</span>
            </span>
            <div className="w-px h-4" style={{ background: 'var(--color-white-subtle)' }} />
            <button
              onClick={handleFork}
              disabled={isForking}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
              style={{ background: 'var(--color-accent)', color: '#fff' }}
            >
              {isForking ? 'Forking...' : 'Fork to my workspace'}
            </button>
          </div>
        )}

        <FlowCanvas isTestUser={isTestUser} readOnly={!isOwner} />
      </div>
    </ReactFlowProvider>
  );
}
