'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useChatStore } from '@/lib/stores/chatStore';
import { useGalleryStore } from '@/lib/stores/galleryStore';
import type { Generation } from '@/types';

/** Resume queued images, videos and draft completions when their session loads. */
export function useChatGenerationPolling() {
  const generations = useChatStore(state => state.generations);
  useEffect(() => {
    const controller = new AbortController();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const supabase = createClient();
    const pending = Object.values(generations).filter(generation => generation.fal_request_id
      && ['pending', 'processing'].includes(generation.status));
    for (const generation of pending) {
      const poll = async () => {
        try {
          const query = new URLSearchParams({ mediaType: generation.media_type });
          if (typeof generation.parameters?.endpoint === 'string') query.set('endpoint', generation.parameters.endpoint);
          const response = await fetch(`/api/fal/status/${generation.fal_request_id}?${query}`, { signal: controller.signal });
          const status = await response.json();
          if (response.ok && ['completed', 'failed'].includes(status.status)) {
            const { data, error } = await supabase.from('generations').select('*').eq('id', generation.id)
              .abortSignal(controller.signal).single();
            if (data && !error && !controller.signal.aborted) {
              useChatStore.getState().addGeneration(data as Generation);
              useGalleryStore.getState().addGeneration(data as Generation);
              return;
            }
          }
        } catch {
          // Transport errors do not imply the paid request failed; retry while mounted.
        }
        schedule();
      };
      const schedule = () => {
        if (controller.signal.aborted) return;
        const timer = setTimeout(() => { timers.delete(timer); void poll(); }, 3000);
        timers.add(timer);
      };
      schedule();
    }
    return () => { controller.abort(); timers.forEach(clearTimeout); };
  }, [generations]);
}
