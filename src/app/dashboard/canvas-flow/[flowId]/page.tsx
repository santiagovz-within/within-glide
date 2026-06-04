'use client';

import { useEffect, useCallback, useState } from 'react';
import { useParams } from 'next/navigation';
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
  const {
    setCurrentFlow, nodes, edges,
    isDirty, setDirty, setSaving, setLastSaved, currentFlow,
  } = useFlowStore();
  const supabase = createClient();
  const [isTestUser, setIsTestUser] = useState(false);

  const loadFlow = useCallback(async () => {
    const { data } = await supabase
      .from('flows')
      .select('*')
      .eq('id', flowId)
      .single();
    if (data) setCurrentFlow(data);
  }, [flowId, supabase, setCurrentFlow]);

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
    if (!isDirty || !currentFlow) return;
    const timer = setTimeout(async () => {
      setSaving(true);
      try {
        const rawThumb = extractThumbnail(nodes);
        const thumbnail = rawThumb ? (await compressToThumbnailDataUrl(rawThumb) ?? rawThumb) : null;
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
        <TopBar flowId={flowId} />
        <FlowCanvas isTestUser={isTestUser} />
      </div>
    </ReactFlowProvider>
  );
}
