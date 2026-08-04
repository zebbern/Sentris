import {
  OperatorRunFindingSummarySchema,
  OperatorRunInspectionResultSchema,
  type ArtifactMetadata,
} from '@sentris/shared';
import {
  Archive,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SeverityBadge } from '@/features/findings/SeverityBadge';
import { useDownloadArtifact, useRunArtifacts } from '@/hooks/queries/useArtifactQueries';

import type { OperatorRunCommandRequest } from './OperatorRunActivity';

interface OperatorRunEvidenceCardProps {
  runId: string;
  result: unknown;
  disabled: boolean;
  onCommand: (request: OperatorRunCommandRequest) => void;
}

export function OperatorRunEvidenceCard({
  runId,
  result,
  disabled,
  onCommand,
}: OperatorRunEvidenceCardProps) {
  const inspection = OperatorRunInspectionResultSchema.safeParse(result);
  const recordedArtifacts =
    inspection.success && inspection.data.diagnostics?.artifacts?.availability === 'available'
      ? inspection.data.diagnostics.artifacts.items
      : undefined;
  const artifactsQuery = useRunArtifacts(recordedArtifacts === undefined ? runId : undefined);
  const downloadArtifact = useDownloadArtifact();

  if (!inspection.success || !inspection.data.terminal || !inspection.data.diagnostics) return null;

  const { trace, findings, artifacts: artifactEvidence } = inspection.data.diagnostics;
  const findingItems = findings.items.flatMap((item) => {
    const parsed = OperatorRunFindingSummarySchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
  const artifacts = recordedArtifacts ?? artifactsQuery.data ?? [];
  const artifactMetric =
    artifactEvidence?.availability === 'available'
      ? artifactEvidence.total
      : artifactsQuery.isLoading
        ? 'Loading'
        : artifactsQuery.isError
          ? 'Unavailable'
          : artifacts.length;

  return (
    <section
      aria-label="Recorded run results"
      className="space-y-3 rounded-md border border-border/70 bg-background/60 p-2.5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
          <ShieldAlert className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          Recorded run results
        </div>
        <Badge variant="outline" className="ml-auto h-5 px-1.5 text-[10px]">
          {inspection.data.status.status}
        </Badge>
      </div>

      <div className="grid grid-cols-1 gap-1.5 text-[11px] sm:grid-cols-3">
        <EvidenceMetric
          label="Trace failures"
          value={trace.availability === 'available' ? (trace.failedEventCount ?? 0) : 'Unavailable'}
        />
        <EvidenceMetric
          label="Findings"
          value={findings.total === null ? 'Unavailable' : findings.total}
        />
        <EvidenceMetric label="Artifacts" value={artifactMetric ?? 'Unavailable'} />
      </div>

      {findings.total !== null && findings.total > 0 ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium text-foreground">Findings</p>
            <Button
              asChild
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 gap-1 px-1.5 text-[10px]"
            >
              <Link to={`/findings?runId=${encodeURIComponent(runId)}`}>
                View all
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </Link>
            </Button>
          </div>
          {findingItems.length > 0 ? (
            findingItems.slice(0, 3).map((finding) => (
              <div
                key={finding.id}
                className="flex flex-wrap items-center gap-2 rounded border border-border/60 bg-card/40 px-2 py-1.5"
              >
                <SeverityBadge severity={finding.severity} />
                <Link
                  to={`/findings?findingId=${encodeURIComponent(finding.id)}`}
                  className="min-w-0 flex-1 truncate text-[11px] font-medium hover:text-primary"
                  title={finding.name ?? finding.id}
                >
                  {finding.name ?? finding.id}
                </Link>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 gap-1 px-1.5 text-[10px]"
                  disabled={disabled}
                  onClick={() =>
                    onCommand({
                      message: `Inspect finding ${finding.id}`,
                      directCommand: {
                        commandName: 'get_finding',
                        arguments: { findingId: finding.id },
                      },
                    })
                  }
                >
                  <Search className="h-3 w-3" aria-hidden="true" />
                  Inspect
                </Button>
              </div>
            ))
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Finding details were omitted from this bounded result. Open the run-scoped findings
              view to review them.
            </p>
          )}
        </div>
      ) : findings.availability === 'available' && findings.total === 0 ? (
        <p className="text-[11px] text-muted-foreground">No findings were recorded for this run.</p>
      ) : null}

      {artifacts.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-foreground">Artifacts</p>
          {artifacts.slice(0, 3).map((artifact) => (
            <ArtifactResultRow
              key={artifact.id}
              artifact={artifact}
              disabled={disabled}
              downloading={
                downloadArtifact.isPending &&
                downloadArtifact.variables?.artifact.id === artifact.id
              }
              onDownload={() => downloadArtifact.mutate({ artifact, runId })}
            />
          ))}
        </div>
      ) : artifactEvidence?.availability === 'available' && artifactEvidence.total === 0 ? (
        <p className="text-[11px] text-muted-foreground">No artifacts were saved for this run.</p>
      ) : null}
    </section>
  );
}

function EvidenceMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded border border-border/60 bg-card/40 px-2 py-1.5">
      <span className="block text-[10px] text-muted-foreground">{label}</span>
      <span className="mt-0.5 block font-mono text-xs font-semibold text-foreground">{value}</span>
    </div>
  );
}

function ArtifactResultRow({
  artifact,
  disabled,
  downloading,
  onDownload,
}: {
  artifact: ArtifactMetadata;
  disabled: boolean;
  downloading: boolean;
  onDownload: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-border/60 bg-card/40 px-2 py-1.5">
      {artifact.mimeType.startsWith('text/') || artifact.mimeType.includes('json') ? (
        <FileText className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
      ) : (
        <Archive className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-medium" title={artifact.name}>
          {artifact.name}
        </span>
        <span className="block truncate text-[10px] text-muted-foreground">
          {artifact.componentRef} · {artifact.mimeType}
        </span>
      </span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-6 gap-1 px-1.5 text-[10px]"
        disabled={disabled || downloading}
        onClick={onDownload}
        aria-label={`Download ${artifact.name}`}
      >
        {downloading ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        ) : (
          <Download className="h-3 w-3" aria-hidden="true" />
        )}
        Download
      </Button>
    </div>
  );
}
