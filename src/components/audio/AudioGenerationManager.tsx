'use client';

import { useEffect } from 'react';
import { recoverAudioGenerations, pollAudioGeneration } from '@/lib/audioGeneration';
import { isAudioPending, useAudioStore } from '@/lib/stores/audioStore';

/** Keep queued recordings moving while the user works elsewhere in the dashboard. */
export function AudioGenerationManager() {
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let lastRecovery = 0;
    const tick = async () => {
      if (cancelled) return;
      if (Date.now() - lastRecovery >= 15_000) {
        lastRecovery = Date.now();
        await recoverAudioGenerations().catch(() => undefined);
      }
      if (cancelled) return;
      await Promise.allSettled(Object.values(useAudioStore.getState().generations)
        .filter(isAudioPending).map(pollAudioGeneration));
      if (!cancelled) timer = setTimeout(tick, 3_000);
    };
    void tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);
  return null;
}
