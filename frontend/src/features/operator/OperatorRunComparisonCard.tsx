import type { OperatorRunComparisonResult } from '@sentris/shared';
import { Check, ExternalLink, Search } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDuration } from '@/utils/timeFormat';
import { cn } from '@/lib/utils';
import type { OperatorRunCommandRequest } from './OperatorRunActivity';

const ASSESSMENT_LABELS: Record<OperatorRunComparisonResult['assessment'], string> = {
  improved: 'Improved',
  regressed: 'Regressed',
  unchanged: 'No clear change',
  inconclusive: 'Inconclusive',
};

const ASSESSMENT_STYLES: Record<OperatorRunComparisonResult['assessment'], string> = {
  improved: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
  regressed: 'border-destructive/40 bg-destructive/10 text-destructive',
  unchanged: 'border-border bg-muted/30 text-muted-foreground',
  inconclusive: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300',
};

interface OperatorRunComparisonCardProps {
  result: OperatorRunComparisonResult;
  disabled: boolean;
  kept?: boolean;
  onCommand: (request: OperatorRunCommandRequest) => void;
}

export function OperatorRunComparisonCard({
  result,
  disabled,
  kept = false,
  onCommand,
}: OperatorRunComparisonCardProps) {
  const candidateVersionId = result.candidate.workflowVersionId;
  const baseVersionId = result.source.workflowVersionId;

  return (
    <div className="space-y-2.5 rounded-md border border-border/70 bg-background/60 p-2.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold">Recorded run comparison</span>
        <Badge
          variant="outline"
          className={cn('ml-auto h-5 px-1.5 text-[10px]', ASSESSMENT_STYLES[result.assessment])}
        >
          {ASSESSMENT_LABELS[result.assessment]}
        </Badge>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <RunEvidence label="Source" evidence={result.source} />
        <RunEvidence label="Candidate" evidence={result.candidate} />
      </div>

      <div className="grid grid-cols-3 gap-1.5 text-center">
        <EvidenceDelta label="Failure events" value={result.changes.failedEventCountDelta} />
        <EvidenceDelta label="Findings" value={result.changes.findingTotalDelta} />
        <EvidenceDelta
          label="Duration"
          value={result.changes.durationDeltaMs}
          format={(value) =>
            `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatDuration(Math.abs(value))}`
          }
        />
      </div>

      {result.successCriteria?.criteria.length ? (
        <div className="space-y-1.5 rounded border border-border/60 bg-card/30 p-2">
          <p className="text-[10px] font-medium text-foreground">Declared success criteria</p>
          {result.successCriteria.criteria.map((comparison) => (
            <div
              key={comparison.criterion.id}
              className="rounded border border-border/50 bg-background/50 px-2 py-1.5"
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[10px] font-medium">
                  {comparison.criterion.title}
                </span>
                <Badge
                  variant="outline"
                  className={cn('h-4 px-1 text-[9px]', ASSESSMENT_STYLES[comparison.assessment])}
                >
                  {ASSESSMENT_LABELS[comparison.assessment]}
                </Badge>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Source {comparison.source.outcome} → Candidate {comparison.candidate.outcome}
              </p>
              <details className="mt-0.5 text-[9px] text-muted-foreground">
                <summary className="cursor-pointer select-none">Evidence</summary>
                <p className="mt-0.5">Source: {comparison.source.message}</p>
                <p>Candidate: {comparison.candidate.message}</p>
              </details>
            </div>
          ))}
        </div>
      ) : null}

      <p className="text-[10px] leading-relaxed text-muted-foreground">{result.caveats[0]}</p>
      {result.caveats.length > 1 ? (
        <details className="text-[10px] text-muted-foreground">
          <summary className="cursor-pointer select-none">Comparison limits</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {result.caveats.slice(1).map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        {candidateVersionId && baseVersionId ? (
          <Button
            type="button"
            size="sm"
            variant={kept ? 'outline' : 'default'}
            className="h-7 gap-1.5 px-2 text-[11px]"
            disabled={disabled || kept}
            onClick={() =>
              onCommand({
                message: `Keep candidate workflow version ${candidateVersionId} from run ${result.candidate.runId}`,
                directCommand: {
                  commandName: 'promote_workflow_version',
                  arguments: {
                    workflowId: result.candidate.workflowId,
                    versionId: candidateVersionId,
                    baseVersionId,
                    candidateRunId: result.candidate.runId,
                  },
                },
              })
            }
          >
            <Check className="h-3 w-3" />
            {kept ? 'Candidate kept' : 'Keep candidate'}
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 px-2 text-[11px]"
          disabled={disabled}
          onClick={() =>
            onCommand({
              message: `Try another evidence-based improvement from candidate run ${result.candidate.runId}, then rerun and compare it.`,
              journey: { kind: 'improve_run', sourceRunId: result.candidate.runId },
            })
          }
        >
          <Search className="h-3 w-3" />
          Revise again
        </Button>
      </div>
    </div>
  );
}

function RunEvidence({
  label,
  evidence,
}: {
  label: string;
  evidence: OperatorRunComparisonResult['source'];
}) {
  return (
    <div className="rounded border border-border/60 bg-card/40 px-2 py-1.5 text-[10px]">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground">{evidence.status}</span>
      </div>
      <Link
        to={`/runs/${encodeURIComponent(evidence.runId)}`}
        className="mt-1 flex items-center gap-1 truncate font-mono text-primary hover:underline"
      >
        <ExternalLink className="h-2.5 w-2.5 shrink-0" />
        <span className="truncate">{evidence.runId}</span>
      </Link>
      <p className="mt-1 text-muted-foreground">
        {evidence.trace.failedEventCount ?? '—'} failure events · {evidence.findings.total ?? '—'}{' '}
        findings · {formatDuration(evidence.durationMs)}
      </p>
    </div>
  );
}

function EvidenceDelta({
  label,
  value,
  format = formatSignedNumber,
}: {
  label: string;
  value: number | null;
  format?: (value: number) => string;
}) {
  return (
    <div className="rounded border border-border/60 bg-card/40 px-1.5 py-1.5">
      <p className="text-[9px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-mono text-[11px] font-medium text-foreground">
        {value === null ? '—' : format(value)}
      </p>
    </div>
  );
}

function formatSignedNumber(value: number): string {
  return `${value > 0 ? '+' : ''}${value}`;
}
