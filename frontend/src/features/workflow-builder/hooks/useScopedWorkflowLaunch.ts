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
    const effectiveRequestKey = requestKey ?? '__generic_launch__';
    if (!requested || !ready || handledRequestRef.current === effectiveRequestKey) return;

    handledRequestRef.current = effectiveRequestKey;
    onConsume();
    void onLaunch();
  }, [onConsume, onLaunch, ready, requestKey, requested]);
}
