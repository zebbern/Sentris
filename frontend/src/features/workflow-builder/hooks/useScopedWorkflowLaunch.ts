import { useEffect, useRef } from 'react';

interface UseScopedWorkflowLaunchOptions {
  requested: boolean;
  ready: boolean;
  requestKey: string | null;
  onConsume: () => void;
  onLaunch: () => void | Promise<void>;
}

export function useScopedWorkflowLaunch({
  requested,
  ready,
  requestKey,
  onConsume,
  onLaunch,
}: UseScopedWorkflowLaunchOptions): void {
  const handledRequestRef = useRef<string | null>(null);

  useEffect(() => {
    if (!requested || !ready || !requestKey || handledRequestRef.current === requestKey) return;

    handledRequestRef.current = requestKey;
    onConsume();
    void onLaunch();
  }, [onConsume, onLaunch, ready, requestKey, requested]);
}
