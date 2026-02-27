import { CheckCircle2, AlertCircle, HelpCircle, RefreshCw } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { McpHealthStatus } from '@shipsec/shared';

interface HealthIndicatorProps {
  status: McpHealthStatus | null;
  checking?: boolean;
}

export function HealthIndicator({ status, checking }: HealthIndicatorProps) {
  const statusConfig = {
    healthy: { icon: CheckCircle2, color: 'text-success', label: 'Healthy' },
    unhealthy: { icon: AlertCircle, color: 'text-destructive', label: 'Unhealthy' },
    unknown: { icon: HelpCircle, color: 'text-muted-foreground', label: 'Not checked' },
  };

  if (checking) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <div className="flex items-center gap-1.5">
              <RefreshCw className="h-4 w-4 text-info animate-spin" />
              <span className="text-xs text-muted-foreground">Checking...</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>Checking server status...</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const config = statusConfig[status ?? 'unknown'];
  const Icon = config.icon;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <div className="flex items-center gap-1.5">
            <Icon className={cn('h-4 w-4', config.color)} />
            <span className="text-xs text-muted-foreground">{config.label}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>Server status: {config.label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
