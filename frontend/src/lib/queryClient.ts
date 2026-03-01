import { MutationCache, QueryClient } from '@tanstack/react-query';
import { humanizeApiError } from '@/lib/humanizeApiError';
import { showToast } from '@/lib/toastRef';

const mutationCache = new MutationCache({
  onError(error, _variables, _context, mutation) {
    if (mutation.meta?.suppressGlobalError === true) return;

    showToast({
      title: 'Operation failed',
      description: humanizeApiError(error),
      variant: 'destructive',
    });
  },
});

export const queryClient = new QueryClient({
  mutationCache,
  defaultOptions: {
    queries: {
      retry: 1,
      retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 5_000),
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      networkMode: 'offlineFirst',
    },
    mutations: {
      retry: 0,
    },
  },
});
