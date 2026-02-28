import { Button } from '@/components/ui/button';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';

/** Retry button used inside the ConfigPanel "component not found" card. */
export function ConfigPanelRetryButton() {
  const queryClient = useQueryClient();
  return (
    <Button
      variant="outline"
      size="sm"
      className="w-fit h-6 text-xs border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/60"
      onClick={() => void queryClient.invalidateQueries({ queryKey: queryKeys.components.all() })}
    >
      Retry
    </Button>
  );
}
