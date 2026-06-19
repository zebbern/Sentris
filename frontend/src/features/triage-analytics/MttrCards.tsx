import { Clock } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorBanner } from '@/components/ui/error-banner';
import { useMttr } from '@/hooks/queries/useTriageAnalyticsQueries';
import { SEVERITY_COLORS, SEVERITY_ORDER, capitalizeFirst, formatDuration } from './constants';

interface MttrCardsProps {
  period: string;
}

export function MttrCards({ period }: MttrCardsProps) {
  const { data, isLoading, isError, error, refetch } = useMttr(period);

  if (isLoading) {
    return (
      <div
        className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4"
        aria-label="Mean time to remediate loading"
        aria-busy="true"
      >
        {SEVERITY_ORDER.map((sev) => (
          <Card key={sev}>
            <CardHeader className="pb-2 pt-4 px-4">
              <Skeleton className="h-4 w-16" />
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <Skeleton className="h-8 w-20 mb-1" />
              <Skeleton className="h-3 w-24" />
            </CardContent>
          </Card>
        ))}
        <span className="sr-only">Loading MTTR data</span>
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorBanner
        message={error?.message ?? 'Failed to load MTTR data'}
        onRetry={() => refetch()}
      />
    );
  }

  const severities = data?.severities ?? [];

  return (
    <div
      className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4"
      role="region"
      aria-label="Mean time to remediate per severity"
    >
      {SEVERITY_ORDER.map((sev) => {
        const entry = severities.find((s) => s.severity.toLowerCase() === sev);
        const mttrDisplay =
          entry && entry.resolvedCount > 0 && entry.mttrSeconds != null
            ? formatDuration(entry.mttrSeconds)
            : 'N/A';
        const resolvedDisplay = entry ? entry.resolvedCount : 0;

        return (
          <Card key={sev}>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: SEVERITY_COLORS[sev] }}
                  aria-hidden="true"
                />
                {capitalizeFirst(sev)}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="flex items-baseline gap-1">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                <span className="text-2xl font-bold tracking-tight">{mttrDisplay}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{resolvedDisplay} resolved</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
