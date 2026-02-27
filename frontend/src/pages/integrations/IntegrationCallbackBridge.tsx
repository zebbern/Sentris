import { useEffect } from 'react';
import type { IntegrationConnection } from './utils';

interface IntegrationCallbackBridgeProps {
  onConnected: (connection: IntegrationConnection) => void;
}

export function IntegrationCallbackBridge({ onConnected }: IntegrationCallbackBridgeProps) {
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<IntegrationConnection>).detail;
      if (detail) {
        onConnected(detail);
      }
    };

    window.addEventListener('integration:connected', listener);
    return () => {
      window.removeEventListener('integration:connected', listener);
    };
  }, [onConnected]);

  return null;
}
