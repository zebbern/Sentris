import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { env } from '@/config/env';
import { cn } from '@/lib/utils';

interface OpenSearchTelemetryLinkProps {
  className?: string;
  variant?: 'button' | 'card';
}

export function OpenSearchTelemetryLink({
  className,
  variant = 'button',
}: OpenSearchTelemetryLinkProps) {
  const url = env.VITE_OPENSEARCH_DASHBOARDS_URL;
  if (!url) return null;

  if (variant === 'card') {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          'inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline',
          className,
        )}
      >
        Open in OpenSearch
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      </a>
    );
  }

  return (
    <Button variant="outline" size="sm" className={cn('shrink-0', className)} asChild>
      <a href={url} target="_blank" rel="noopener noreferrer">
        <ExternalLink className="h-4 w-4 mr-1.5" aria-hidden="true" />
        Run Telemetry
      </a>
    </Button>
  );
}
