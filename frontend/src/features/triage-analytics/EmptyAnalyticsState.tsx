import { BarChart3 } from 'lucide-react';

interface EmptyAnalyticsStateProps {
  message?: string;
  icon?: React.ReactNode;
}

export function EmptyAnalyticsState({
  message = 'No data available',
  icon,
}: EmptyAnalyticsStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
      {icon ?? <BarChart3 className="h-10 w-10 mb-3 opacity-40" />}
      <p className="text-sm">{message}</p>
    </div>
  );
}
