import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { BarChart3 } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { ErrorBanner } from '@/components/ui/error-banner';
import { useFindingsStatsQuery } from '@/hooks/queries/useFindingsQueries';
import type { FindingsStatsParams } from '@/services/api/findings';
import { buildSeverityChartData } from './severityChartData';
import { describeFindingDataQuality, shouldShowFindingDataQuality } from './findingDataQuality';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SeverityChartProps = FindingsStatsParams;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#3b82f6',
  info: '#6b7280',
  none: '#94a3b8',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SeverityChart(props: SeverityChartProps) {
  const { data, isLoading, error, refetch } = useFindingsStatsQuery(props);

  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <h3 className="text-sm font-semibold mb-3">Severity Distribution</h3>
        <Skeleton className="h-[200px] w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <h3 className="text-sm font-semibold mb-3">Severity Distribution</h3>
        <ErrorBanner
          message={error.message ?? 'Failed to load severity distribution'}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const counts = data?.severityCounts ?? [];
  const hasData = counts.some((c) => c.count > 0);
  const showDataQuality = data ? shouldShowFindingDataQuality(data) : false;

  if (!hasData && !showDataQuality) {
    return null;
  }

  // Sort by severity order and normalise labels
  const chartData = buildSeverityChartData(counts);

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Severity Distribution</h3>
      </div>
      {data && showDataQuality && (
        <div
          role="status"
          aria-label="Severity data quality"
          className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
        >
          {describeFindingDataQuality(data)}
        </div>
      )}
      {hasData && (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
            <XAxis dataKey="severity" tick={{ fontSize: 12 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '6px',
                fontSize: '12px',
              }}
            />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {chartData.map((entry) => (
                <Cell key={entry.key} fill={SEVERITY_COLORS[entry.key] ?? '#6b7280'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
