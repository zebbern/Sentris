import { Clock } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorBanner } from '@/components/ui/error-banner';
import { useMttr } from '@/hooks/queries/useTriageAnalyticsQueries';
import {
  SEVERITY_ORDER,
  capitalizeFirst,
  formatDuration,
  getSeverityCardTintStyle,
} from './constants';

interface MttrCardsProps {
  period: string;
}

const MTTR_GRID_CLASS = 'grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3';
const MTTR_CARD_HEADER_CLASS = 'pb-1 pt-2 px-2 sm:px-3';
const MTTR_CARD_CONTENT_CLASS = 'px-2 sm:px-3 pb-2 sm:pb-3';

export function MttrCards({ period }: MttrCardsProps) {
  const { data, isLoading, isError, error, refetch } = useMttr(period);

  if (isLoading) {
    return (
      <div className={MTTR_GRID_CLASS} aria-label="Mean time to remediate loading" aria-busy="true">
        {SEVERITY_ORDER.map((sev) => (
          <Card key={sev} className="min-w-0" style={getSeverityCardTintStyle(sev)}>
            <CardHeader className={MTTR_CARD_HEADER_CLASS}>
              <Skeleton className="h-3.5 w-14" />
            </CardHeader>
            <CardContent className={MTTR_CARD_CONTENT_CLASS}>
              <Skeleton className="h-6 w-16 mb-1" />
              <Skeleton className="h-3 w-20" />
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
    <div className={MTTR_GRID_CLASS} role="region" aria-label="Mean time to remediate per severity">
      {SEVERITY_ORDER.map((sev) => {
        const entry = severities.find((s) => s.severity.toLowerCase() === sev);
        const mttrDisplay =
          entry && entry.resolvedCount > 0 && entry.mttrSeconds != null
            ? formatDuration(entry.mttrSeconds)
            : 'N/A';
        const resolvedDisplay = entry ? entry.resolvedCount : 0;

        return (
          <Card key={sev} className="min-w-0" style={getSeverityCardTintStyle(sev)}>
            <CardHeader className={MTTR_CARD_HEADER_CLASS}>
              <CardTitle className="text-[11px] sm:text-xs font-medium text-muted-foreground truncate">
                {capitalizeFirst(sev)}
              </CardTitle>
            </CardHeader>
            <CardContent className={MTTR_CARD_CONTENT_CLASS}>
              <div className="flex items-baseline gap-1 min-w-0">
                <Clock className="h-3 w-3 text-muted-foreground flex-shrink-0" aria-hidden="true" />
                <span className="text-lg sm:text-xl font-bold tracking-tight truncate">
                  {mttrDisplay}
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5 truncate">
                {resolvedDisplay} resolved
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
