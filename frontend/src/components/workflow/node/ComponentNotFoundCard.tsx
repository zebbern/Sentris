import { AlertCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { queryKeys } from '@/lib/queryKeys';

/** Small error card shown when a component's metadata cannot be resolved. */
export function ComponentNotFoundCard({ componentRef }: { componentRef: string | undefined }) {
  const queryClient = useQueryClient();

  const handleRetry = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.components.all() });
  };

  return (
    <div className="px-4 py-3 shadow-md rounded-lg border-2 border-red-500 dark:border-red-700 bg-red-50 dark:bg-red-900/40 min-w-[200px]">
      <div className="flex items-start gap-2">
        <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-red-700 dark:text-red-300 font-medium">
            This component&#39;s metadata could not be loaded
          </span>
          <span className="text-xs text-red-600/70 dark:text-red-400/70">
            {componentRef ?? 'unknown'}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="w-fit h-6 text-xs border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/60"
            onClick={handleRetry}
          >
            Retry
          </Button>
        </div>
      </div>
    </div>
  );
}
