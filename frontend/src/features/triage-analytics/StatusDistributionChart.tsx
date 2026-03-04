import { useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { PieChartIcon } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { ErrorBanner } from '@/components/ui/error-banner';
import { useStatusDistribution } from '@/hooks/queries/useTriageAnalyticsQueries';
import { EmptyAnalyticsState } from './EmptyAnalyticsState';
import { STATUS_COLORS, CHART_TOOLTIP_STYLE, formatStatusLabel } from './constants';

export function StatusDistributionChart() {
  const { data, isLoading, isError, error, refetch } = useStatusDistribution();
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const chartData = useMemo(() => {
    if (!data?.statuses) return [];
    return data.statuses
      .filter((s) => s.count > 0)
      .map((s) => ({
        name: formatStatusLabel(s.status),
        value: s.count,
        key: s.status,
      }));
  }, [data]);

  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card p-4" aria-busy="true">
        <div className="flex items-center gap-2 mb-3">
          <PieChartIcon className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Status Distribution</h3>
        </div>
        <Skeleton className="h-[280px] w-full" />
        <span className="sr-only">Loading status distribution data</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <PieChartIcon className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Status Distribution</h3>
        </div>
        <ErrorBanner
          message={error?.message ?? 'Failed to load status distribution'}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div
        className="rounded-lg border bg-card p-4"
        role="img"
        aria-label="Status distribution chart — no data available"
      >
        <div className="flex items-center gap-2 mb-3">
          <PieChartIcon className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Status Distribution</h3>
        </div>
        <EmptyAnalyticsState message="No findings to display" />
      </div>
    );
  }

  const total = data?.total ?? 0;

  return (
    <div
      className="rounded-lg border bg-card p-4"
      role="img"
      aria-label={`Status distribution chart — ${total} total findings`}
    >
      <div className="flex items-center gap-2 mb-3">
        <PieChartIcon className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Status Distribution</h3>
        <span className="text-xs text-muted-foreground ml-auto">{total} total</span>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
            dataKey="value"
            nameKey="name"
            isAnimationActive={!prefersReducedMotion}
            label={({ name, percent }: { name?: string; percent?: number }) =>
              `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`
            }
          >
            {chartData.map((entry) => (
              <Cell
                key={entry.key}
                fill={STATUS_COLORS[entry.key] ?? '#6b7280'}
              />
            ))}
          </Pie>
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
          />
          <Legend
            formatter={(value: string) => (
              <span className="text-xs">{value}</span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
      <table className="sr-only">
        <caption>Finding status distribution</caption>
        <thead>
          <tr>
            <th scope="col">Status</th>
            <th scope="col">Count</th>
          </tr>
        </thead>
        <tbody>
          {chartData.map((d) => (
            <tr key={d.key}>
              <td>{d.name}</td>
              <td>{d.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
