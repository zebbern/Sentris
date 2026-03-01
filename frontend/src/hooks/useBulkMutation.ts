import { useCallback, useRef } from 'react';

/** Toast message templates for success and partial-failure outcomes. */
export interface BulkMutationMessages {
  /** Toast title when all operations succeed. Receives the succeeded count. */
  successTitle: (succeeded: number) => string;
  /** Toast description when all operations succeed. Receives the succeeded count. */
  successDescription: (succeeded: number) => string;
  /** Toast description when some operations fail. */
  partialDescription: (succeeded: number, total: number, failed: number) => string;
}

export interface UseBulkMutationOptions {
  /** The mutation's async function, called once per ID. */
  mutateAsync: (id: string) => Promise<unknown>;
  /** Clears the bulk-selection state after the operation completes. */
  clearSelection: () => void;
  /** Toast function from `useToast()`. */
  toast: (options: { title: string; description: string; variant?: 'destructive' }) => unknown;
  /** Toast message templates for success and partial-failure outcomes. */
  messages: BulkMutationMessages;
}

/**
 * Returns a stable async function that executes a mutation against a list of
 * IDs using `Promise.allSettled`, clears the selection, and shows an
 * appropriate success or partial-failure toast.
 *
 * Pre-filtering (e.g. picking only active items) and confirmation dialogs
 * are the caller's responsibility — call `executeBulk` only after both.
 *
 * @example
 * ```ts
 * const executeBulkDelete = useBulkMutation({
 *   mutateAsync: (id) => deleteMutation.mutateAsync(id),
 *   clearSelection,
 *   toast,
 *   messages: {
 *     successTitle: (n) => `Deleted ${n} item${n !== 1 ? 's' : ''}`,
 *     successDescription: (n) => `${n} item${n !== 1 ? 's' : ''} removed.`,
 *     partialDescription: (s, t, f) => `Deleted ${s} of ${t} items (${f} failed).`,
 *   },
 * });
 *
 * // Inside a handler (after any filtering / confirmation):
 * await executeBulkDelete(ids);
 * ```
 */
export function useBulkMutation(options: UseBulkMutationOptions): (ids: string[]) => Promise<void> {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  return useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;

    const { mutateAsync, clearSelection, toast, messages } = optionsRef.current;

    const results = await Promise.allSettled(ids.map((id) => mutateAsync(id)));
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    clearSelection();

    if (failed === 0) {
      toast({
        title: messages.successTitle(succeeded),
        description: messages.successDescription(succeeded),
      });
    } else {
      toast({
        title: 'Partial failure',
        description: messages.partialDescription(succeeded, ids.length, failed),
        variant: 'destructive',
      });
    }
  }, []);
}
