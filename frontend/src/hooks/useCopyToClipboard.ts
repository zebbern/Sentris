import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { logger } from '@/lib/logger';

export interface CopyOptions {
  /** Title for the success toast. Defaults to `"Copied"`. */
  successTitle?: string;
  /** Description for the success toast. Defaults to `"Copied to clipboard."`. */
  successDescription?: string;
  /** Title for the error toast. Defaults to `"Copy failed"`. */
  errorTitle?: string;
  /** Description for the error toast. Defaults to `"Failed to copy to clipboard."`. */
  errorDescription?: string;
  /** Whether to show a toast notification. Defaults to `true`. */
  showToast?: boolean;
}

/**
 * Hook for copying text to the clipboard with toast notifications
 * and a 2-second "copied" indicator.
 *
 * @returns `copy` — async function that writes to clipboard and shows a toast.
 * @returns `copiedText` — the last successfully copied string (resets after 2 s).
 * @returns `isCopied` — helper to check whether a specific string was just copied.
 */
export function useCopyToClipboard() {
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const { toast } = useToast();
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(
    async (text: string, options?: CopyOptions): Promise<boolean> => {
      const {
        successTitle = 'Copied',
        successDescription = 'Copied to clipboard.',
        errorTitle = 'Copy failed',
        errorDescription = 'Failed to copy to clipboard.',
        showToast: shouldShowToast = true,
      } = options ?? {};

      try {
        await navigator.clipboard.writeText(text);

        setCopiedText(text);

        if (resetTimerRef.current !== null) {
          clearTimeout(resetTimerRef.current);
        }
        resetTimerRef.current = setTimeout(() => {
          setCopiedText((current) => (current === text ? null : current));
        }, 2000);

        if (shouldShowToast) {
          toast({ title: successTitle, description: successDescription });
        }

        return true;
      } catch (error: unknown) {
        logger.error('[useCopyToClipboard] Failed to copy to clipboard', error);

        if (shouldShowToast) {
          toast({
            title: errorTitle,
            description: errorDescription,
            variant: 'destructive',
          });
        }

        return false;
      }
    },
    [toast],
  );

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  const isCopied = useCallback((text: string) => copiedText === text, [copiedText]);

  return { copy, copiedText, isCopied } as const;
}
