import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
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
