import { useSearchParams } from 'react-router-dom';

import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { PeriodSelector } from '@/features/triage-analytics/PeriodSelector';
import { MttrCards } from '@/features/triage-analytics/MttrCards';
import { PostureTrendChart } from '@/features/triage-analytics/PostureTrendChart';
import { StatusDistributionChart } from '@/features/triage-analytics/StatusDistributionChart';
import { TriageVelocityChart } from '@/features/triage-analytics/TriageVelocityChart';
import { SlaComplianceChart } from '@/features/triage-analytics/SlaComplianceChart';
import { TopAssigneesTable } from '@/features/triage-analytics/TopAssigneesTable';
import { SlaPolicySettings } from '@/features/triage-analytics/SlaPolicySettings';
import { OpenSearchTelemetryLink } from '@/components/analytics/OpenSearchTelemetryLink';

const DEFAULT_PERIOD = '30d';
const VALID_PERIODS = new Set(['7d', '30d', '90d']);

export function TriageAnalyticsPage() {
  useDocumentTitle('Triage Analytics');

  const [searchParams, setSearchParams] = useSearchParams();
  const rawPeriod = searchParams.get('period') ?? DEFAULT_PERIOD;
  const period = VALID_PERIODS.has(rawPeriod) ? rawPeriod : DEFAULT_PERIOD;

  const handlePeriodChange = (value: string) => {
    setSearchParams({ period: value }, { replace: true });
  };

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6 lg:p-8 max-w-[1400px] mx-auto w-full">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodSelector value={period} onChange={handlePeriodChange} />
        <OpenSearchTelemetryLink className="shrink-0" />
      </div>

      {/* MTTR KPI Cards */}
      <section aria-label="Mean Time to Remediate">
        <MttrCards period={period} />
      </section>

      {/* Posture Trend + Status Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2" aria-label="Posture Trend">
          <PostureTrendChart period={period} />
        </section>
        <section aria-label="Status Distribution">
          <StatusDistributionChart />
        </section>
      </div>

      {/* Triage Velocity + SLA Compliance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section aria-label="Triage Velocity">
          <TriageVelocityChart period={period} />
        </section>
        <section aria-label="SLA Compliance">
          <SlaComplianceChart period={period} />
        </section>
      </div>

      {/* Top Assignees */}
      <section aria-label="Top Assignees">
        <TopAssigneesTable />
      </section>

      {/* SLA Policy Settings (collapsible) */}
      <section aria-label="SLA Policy Configuration">
        <SlaPolicySettings />
      </section>
    </div>
  );
}
