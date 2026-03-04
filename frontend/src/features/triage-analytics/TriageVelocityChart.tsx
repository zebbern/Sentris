import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';
import { Activity } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { ErrorBanner } from '@/components/ui/error-banner';
import { useTriageVelocity } from '@/hooks/queries/useTriageAnalyticsQueries';
import { EmptyAnalyticsState } from './EmptyAnalyticsState';
import { STATUS_COLORS, CHART_TOOLTIP_STYLE, formatStatusLabel } from './constants';

const STATUS_KEYS = [
  'new',
  'triaged',
  'in_progress',
  'fixed',
  'verified',
  'wont_fix',
  'accepted_risk',
] as const;

interface TriageVelocityChartProps {
  period: string;
}

export function TriageVelocityChart({ period }: TriageVelocityChartProps) {
  const { data, isLoading, isError, error, refetch } = useTriageVelocity(period);
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card p-4" aria-busy="true">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Triage Velocity</h3>
        </div>
        <Skeleton className="h-[280px] w-full" />
        <span className="sr-only">Loading triage velocity data</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Triage Velocity</h3>
        </div>
        <ErrorBanner message={error?.message ?? 'Failed to load triage velocity'} onRetry={() => refetch()} />
      </div>
    );
  }

  const buckets = data?.buckets ?? [];
  const hasData = buckets.some((b) =>
    STATUS_KEYS.some((k) => b[k] > 0),
  );

  if (!hasData) {
    return (
      <div
        className="rounded-lg border bg-card p-4"
        role="img"
        aria-label="Triage velocity chart — no data available"
      >
        <div className="flex items-center gap-2 mb-3">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Triage Velocity</h3>
        </div>
        <EmptyAnalyticsState message="No triage velocity data for this period" />
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border bg-card p-4"
      role="img"
      aria-label="Triage velocity chart showing finding status transitions over time"
    >
      <div className="flex items-center gap-2 mb-3">
        <Activity className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Triage Velocity</h3>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={buckets} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
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
          {STATUS_KEYS.map((status) => (
            <Bar
              key={status}
              dataKey={status}
              name={formatStatusLabel(status)}
              stackId="velocity"
              fill={STATUS_COLORS[status]}
              radius={0}
              isAnimationActive={!prefersReducedMotion}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <table className="sr-only">
        <caption>Triage velocity data by status</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            {STATUS_KEYS.map((s) => (
              <th key={s} scope="col">
                {formatStatusLabel(s)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.date}>
              <td>{b.date}</td>
              {STATUS_KEYS.map((s) => (
                <td key={s}>{b[s]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
