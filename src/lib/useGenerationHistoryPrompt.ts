'use client';

import { useEffect, useRef, useState } from 'react';
import { selectGenerationVersion } from '@/lib/selectGenerationVersion';

export function useGenerationHistoryPrompt(nodeId: string, onPrompt: (prompt: string) => void = () => {}) {
  const request = useRef<AbortController | null>(null);
  const [restoringPrompt, setRestoringPrompt] = useState(false);
  const [promptHistoryError, setPromptHistoryError] = useState<string>();
  useEffect(() => () => request.current?.abort(), [nodeId]);

  function restoreVersion(index: number) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setRestoringPrompt(true);
    setPromptHistoryError(undefined);
    void selectGenerationVersion(nodeId, index, controller.signal, onPrompt)
      .catch(() => {
        if (!controller.signal.aborted) setPromptHistoryError('The saved prompt is unavailable for this version.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setRestoringPrompt(false);
      });
  }

  return { restoreVersion, restoringPrompt, promptHistoryError };
}
