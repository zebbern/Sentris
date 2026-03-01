import '@tanstack/react-query';

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      /** When `true`, the global MutationCache `onError` handler will skip this mutation (no automatic destructive toast). */
      suppressGlobalError?: boolean;
    };
  }
}
