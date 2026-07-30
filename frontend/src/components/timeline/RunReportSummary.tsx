import { useMemo } from 'react';
import type { ArtifactMetadata } from '@sentris/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useArtifactPreview } from '@/hooks/queries/useArtifactQueries';
import { extractRunReportSummary, selectReportArtifact } from './runReportSummaryData';

export function RunReportSummary({
  runId,
  artifacts,
  onViewReport,
}: {
  runId: string;
  artifacts: ArtifactMetadata[];
  onViewReport: () => void;
}) {
  const artifact = useMemo(() => selectReportArtifact(artifacts), [artifacts]);
  const preview = useArtifactPreview(runId, artifact);
  const summary = useMemo(
    () => (preview.data?.status === 'ready' ? extractRunReportSummary(preview.data.content) : null),
    [preview.data],
  );
  const hasSummary = Boolean(
    summary && (summary.metrics.length > 0 || summary.notice || summary.nextSteps.length > 0),
  );

  return (
    <div className="space-y-2 text-xs">
      {preview.isLoading ? (
        <p className="text-muted-foreground" aria-live="polite">
          Preparing report summary…
        </p>
      ) : hasSummary && summary ? (
        <>
          {summary.metrics.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {summary.metrics.map((metric) => (
                <Badge key={metric.label} variant="secondary" className="text-[10px]">
                  {metric.label}: {metric.value}
                </Badge>
              ))}
            </div>
          )}
          {summary.notice && <p className="text-muted-foreground">{summary.notice}</p>}
          {summary.nextSteps.length > 0 && (
            <div>
              <p className="mb-1 font-medium">Next steps</p>
              <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                {summary.nextSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <p className="text-muted-foreground">View the full report for run details.</p>
      )}

      <Button type="button" variant="outline" size="sm" onClick={onViewReport}>
        View full report
      </Button>
    </div>
  );
}
