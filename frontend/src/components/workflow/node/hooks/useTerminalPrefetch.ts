import { useState, useEffect } from 'react';
import { logger } from '@/lib/logger';
import { useExecutionStore } from '@/store/executionStore';
import { useWorkflowUiStore } from '@/store/workflowUiStore';

interface UseTerminalPrefetchOptions {
  id: string;
  selectedRunId: string | null;
}

/**
 * Prefetches terminal data when the terminal is docked for a given node.
 */
export function useTerminalPrefetch({ id, selectedRunId }: UseTerminalPrefetchOptions) {
  const prefetchTerminal = useExecutionStore((state) => state.prefetchTerminal);
  const terminalSession = useExecutionStore((state) => state.getTerminalSession(id, 'pty'));
  const dockedTerminals = useWorkflowUiStore((s) => s.dockedTerminals);
  const isTerminalDocked = dockedTerminals.some((t) => t.nodeId === id);
  const [isTerminalLoading, setIsTerminalLoading] = useState(false);

  useEffect(() => {
    if (!isTerminalDocked) return;

    let cancelled = false;
    const loadTerminal = async () => {
      setIsTerminalLoading(true);
      try {
        await prefetchTerminal(id, 'pty', selectedRunId ?? undefined);
      } catch (error: unknown) {
        logger.error('Failed to prefetch terminal output', error);
      } finally {
        if (!cancelled) setIsTerminalLoading(false);
      }
    };

    void loadTerminal();
    return () => {
      cancelled = true;
    };
  }, [id, isTerminalDocked, prefetchTerminal, selectedRunId]);

  return { isTerminalLoading, terminalSession };
}
