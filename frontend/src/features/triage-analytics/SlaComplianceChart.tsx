import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
  ReferenceLine,
  LabelList,
} from 'recharts';
import { ShieldCheck } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { ErrorBanner } from '@/components/ui/error-banner';
import { useSlaCompliance } from '@/hooks/queries/useTriageAnalyticsQueries';
import { EmptyAnalyticsState } from './EmptyAnalyticsState';
import { SEVERITY_ORDER, CHART_TOOLTIP_STYLE, capitalizeFirst } from './constants';

function getComplianceColor(rate: number): string {
  if (rate >= 90) return '#16a34a'; // green-600
  if (rate >= 50) return '#ca8a04'; // amber-600
  return '#ef4444'; // red
}

interface SlaComplianceChartProps {
  period: string;
}

export function SlaComplianceChart({ period }: SlaComplianceChartProps) {
  const { data, isLoading, isError, error, refetch } = useSlaCompliance(period);
  const prefersReducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const chartData = useMemo(() => {
    if (!data?.severities) return [];
    return SEVERITY_ORDER.map((sev) => {
      const entry = data.severities.find((s) => s.severity.toLowerCase() === sev);
      return {
        severity: capitalizeFirst(sev),
        key: sev,
        complianceRate:
          entry?.complianceRate != null ? Math.round(entry.complianceRate * 100) / 100 : 0,
        totalWithSla: entry?.totalWithSla ?? 0,
        metSla: entry?.metSla ?? 0,
        missedSla: entry?.missedSla ?? 0,
      };
    }).filter((d) => d.totalWithSla > 0);
  }, [data]);

  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card p-4" aria-busy="true">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">SLA Compliance</h3>
        </div>
        <Skeleton className="h-[280px] w-full" />
        <span className="sr-only">Loading SLA compliance data</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">SLA Compliance</h3>
        </div>
        <ErrorBanner
          message={error?.message ?? 'Failed to load SLA compliance'}
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
        aria-label="SLA compliance chart — no data available"
      >
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">SLA Compliance</h3>
        </div>
        <EmptyAnalyticsState message="No SLA data — configure SLA policies below" />
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border bg-card p-4"
      role="img"
      aria-label="SLA compliance chart showing percentage of findings meeting SLA per severity"
    >
      <div className="flex items-center gap-2 mb-3">
        <ShieldCheck className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">SLA Compliance</h3>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="severity" tick={{ fontSize: 12 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} tickFormatter={(v: number) => `${v}%`} />
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            formatter={(value) => [`${Number(value ?? 0).toFixed(1)}%`, 'Compliance']}
          />
          <ReferenceLine
            y={90}
            stroke="#16a34a"
            strokeDasharray="3 3"
            label={{ value: '90%', position: 'right', fontSize: 10 }}
          />
          <Bar
            dataKey="complianceRate"
            radius={[4, 4, 0, 0]}
            isAnimationActive={!prefersReducedMotion}
          >
            {chartData.map((entry) => (
              <Cell key={entry.key} fill={getComplianceColor(entry.complianceRate)} />
            ))}
            <LabelList
              dataKey="complianceRate"
              position="top"
              fontSize={10}
              formatter={(v) => `${v}%`}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <table className="sr-only">
        <caption>SLA compliance by severity</caption>
        <thead>
          <tr>
            <th scope="col">Severity</th>
            <th scope="col">Compliance Rate</th>
            <th scope="col">Met SLA</th>
            <th scope="col">Missed SLA</th>
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {chartData.map((d) => (
            <tr key={d.key}>
              <td>{d.severity}</td>
              <td>{d.complianceRate}%</td>
              <td>{d.metSla}</td>
              <td>{d.missedSla}</td>
              <td>{d.totalWithSla}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
