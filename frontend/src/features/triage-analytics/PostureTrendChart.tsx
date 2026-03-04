import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';
import { TrendingUp } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { ErrorBanner } from '@/components/ui/error-banner';
import { usePostureTrend } from '@/hooks/queries/useTriageAnalyticsQueries';
import { EmptyAnalyticsState } from './EmptyAnalyticsState';
import { SEVERITY_COLORS, SEVERITY_ORDER, CHART_TOOLTIP_STYLE, capitalizeFirst } from './constants';

interface PostureTrendChartProps {
  period: string;
}

export function PostureTrendChart({ period }: PostureTrendChartProps) {
  const { data, isLoading, isError, error, refetch } = usePostureTrend(period);
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card p-4" aria-busy="true">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Posture Trend</h3>
        </div>
        <Skeleton className="h-[280px] w-full" />
        <span className="sr-only">Loading posture trend data</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Posture Trend</h3>
        </div>
        <ErrorBanner message={error?.message ?? 'Failed to load posture trend'} onRetry={() => refetch()} />
      </div>
    );
  }

  const buckets = data?.buckets ?? [];
  const hasData = buckets.some(
    (b) => b.critical > 0 || b.high > 0 || b.medium > 0 || b.low > 0 || b.info > 0,
  );

  if (!hasData) {
    return (
      <div
        className="rounded-lg border bg-card p-4"
        role="img"
        aria-label="Posture trend chart — no data available"
      >
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Posture Trend</h3>
        </div>
        <EmptyAnalyticsState message="No posture trend data for this period" />
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border bg-card p-4"
      role="img"
      aria-label="Posture trend chart showing findings by severity over time"
    >
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Posture Trend</h3>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={buckets} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11 }}
            tickFormatter={(v: string) => {
              const d = new Date(v);
              return `${d.getMonth() + 1}/${d.getDate()}`;
            }}
          />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
          <Legend />
          {SEVERITY_ORDER.map((sev) => (
            <Area
              key={sev}
              type="monotone"
              dataKey={sev}
              name={capitalizeFirst(sev)}
              stackId="1"
              stroke={SEVERITY_COLORS[sev]}
              fill={SEVERITY_COLORS[sev]}
              fillOpacity={0.6}
              isAnimationActive={!prefersReducedMotion}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      <table className="sr-only">
        <caption>Posture trend data by severity</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            {SEVERITY_ORDER.map((sev) => (
              <th key={sev} scope="col">
                {capitalizeFirst(sev)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.date}>
              <td>{b.date}</td>
              <td>{b.critical}</td>
              <td>{b.high}</td>
              <td>{b.medium}</td>
              <td>{b.low}</td>
              <td>{b.info}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
