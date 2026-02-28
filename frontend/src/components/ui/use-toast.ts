import { useContext } from 'react';
import { ToastContext, type ToastContextValue } from './toast-context';
import { logger } from '@/lib/logger';

const noopToast: ToastContextValue = {
  toast: ({ title, description }) => {
    logger.warn('[toast]', title, description);
    return { id: 'noop' };
  },
  dismiss: () => {},
};

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    return noopToast;
  }
  return context;
}
