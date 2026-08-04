import type {
  OperatorWorkflowApplyResult,
  OperatorWorkflowDraftDetail,
  OperatorWorkflowDraftResult,
} from '@sentris/shared';
import {
  AlertCircle,
  ArrowRight,
  Check,
  ExternalLink,
  Play,
  Save,
  WandSparkles,
  Workflow,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { WorkflowPreview } from '@/features/templates/WorkflowPreview';
import { createOperatorWorkflowDraftRevisionNavigationState } from './operatorHandoff';

interface OperatorWorkflowDraftCardProps {
  sessionId: string;
  result: OperatorWorkflowDraftResult | OperatorWorkflowApplyResult;
  detail?: OperatorWorkflowDraftDetail;
  disabled?: boolean;
  applied?: boolean;
  onApply: (draft: OperatorWorkflowDraftResult) => void;
  onRunSavedVersion?: (result: OperatorWorkflowApplyResult) => void;
  onRunImprovedVersion?: (result: OperatorWorkflowApplyResult) => void;
}

function buildDraftBuilderPath(
  result: OperatorWorkflowDraftResult,
  operatorSessionId: string,
): string {
  const search = new URLSearchParams({ operatorSessionId, draftId: result.draftId });
  return `/workflows/${encodeURIComponent(result.workflowId ?? 'new')}?${search.toString()}`;
}

function describeDiff(result: OperatorWorkflowDraftResult): string[] {
  const { diff } = result;
  const descriptions: string[] = [];

  if (diff.metadataChanged.length > 0) {
    descriptions.push(`Updated ${diff.metadataChanged.join(' and ')}`);
  }
  if (diff.successCriteriaChanged) descriptions.push('Updated success criteria');
  if (diff.addedNodeIds.length > 0) descriptions.push(`Added ${diff.addedNodeIds.length} nodes`);
  if (diff.removedNodeIds.length > 0) {
    descriptions.push(`Removed ${diff.removedNodeIds.length} nodes`);
  }
  if (diff.changedNodeIds.length > 0) {
    descriptions.push(`Changed ${diff.changedNodeIds.length} nodes`);
  }
  if (diff.addedEdgeIds.length > 0) {
    descriptions.push(`Added ${diff.addedEdgeIds.length} connections`);
  }
  if (diff.removedEdgeIds.length > 0) {
    descriptions.push(`Removed ${diff.removedEdgeIds.length} connections`);
  }
  if (diff.changedEdgeIds.length > 0) {
    descriptions.push(`Changed ${diff.changedEdgeIds.length} connections`);
  }

  return descriptions.length > 0 ? descriptions : ['No graph changes'];
}

function GraphPreview({ label, graph }: { label: string; graph: unknown }) {
  return (
    <figure className="min-w-0 overflow-hidden rounded-md border border-border/60 bg-muted/20">
      <figcaption className="border-b border-border/50 px-2 py-1 text-[10px] font-medium text-muted-foreground">
        {label}
      </figcaption>
      <div className="h-32 p-2">
        <WorkflowPreview graph={graph} className="h-full w-full" />
      </div>
    </figure>
  );
}

export function OperatorWorkflowDraftCard({
  sessionId,
  result,
  detail,
  disabled = false,
  applied = false,
  onApply,
  onRunSavedVersion,
  onRunImprovedVersion,
}: OperatorWorkflowDraftCardProps) {
  if (result.kind === 'workflow-applied') {
    const canRunSavedVersion = !result.staged && Boolean(onRunSavedVersion);
    const canRunImprovedVersion =
      !result.created && Boolean(result.sourceRunId) && Boolean(onRunImprovedVersion);

    return (
      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/[0.05] p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Workflow className="h-3.5 w-3.5 text-emerald-500" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{result.name}</span>
          <Badge
            variant="outline"
            className="h-5 border-emerald-500/30 px-1.5 text-[10px] text-emerald-600 dark:text-emerald-300"
          >
            {result.created
              ? 'Created'
              : result.staged
                ? `Staged v${result.version}`
                : `Saved as v${result.version}`}
          </Badge>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button asChild variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-[11px]">
            <Link to={`/workflows/${encodeURIComponent(result.workflowId)}`}>
              <ExternalLink className="h-3 w-3" />
              Open workflow
            </Link>
          </Button>
          {canRunSavedVersion ? (
            <Button
              type="button"
              size="sm"
              className="h-7 gap-1.5 px-2 text-[11px]"
              disabled={disabled}
              onClick={() => onRunSavedVersion?.(result)}
            >
              <Play className="h-3 w-3" />
              Run now
            </Button>
          ) : null}
          {canRunImprovedVersion ? (
            <Button
              type="button"
              size="sm"
              className="h-7 gap-1.5 px-2 text-[11px]"
              disabled={disabled}
              onClick={() => onRunImprovedVersion?.(result)}
            >
              <Play className="h-3 w-3" />
              Run improved version
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const diffDescriptions = describeDiff(result);
  const builderPath = buildDraftBuilderPath(result, sessionId);
  const operatorPath = `/operator/${encodeURIComponent(sessionId)}`;
  const revisionPath = `${operatorPath}?reviseDraftId=${encodeURIComponent(result.draftId)}`;
  const revisionNavigationState = createOperatorWorkflowDraftRevisionNavigationState(
    result.draftId,
    operatorPath,
  );

  return (
    <div className="space-y-2.5 rounded-md border border-primary/20 bg-primary/[0.03] p-2.5">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">{result.name}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{result.digest}</p>
        </div>
        <Badge
          variant="outline"
          className={
            result.validation.valid
              ? 'h-5 border-emerald-500/30 px-1.5 text-[10px] text-emerald-600 dark:text-emerald-300'
              : 'h-5 border-destructive/30 px-1.5 text-[10px] text-destructive'
          }
        >
          {result.validation.valid ? 'Validated' : 'Needs fixes'}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {diffDescriptions.map((description) => (
          <span
            key={description}
            className="rounded border border-border/60 bg-background/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
          >
            {description}
          </span>
        ))}
      </div>

      {!result.validation.valid ? (
        <div className="rounded-md border border-destructive/25 bg-destructive/[0.04] p-2">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-destructive">
            <AlertCircle className="h-3 w-3" />
            Resolve validation errors before saving
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[10px] text-muted-foreground">
            {result.validation.errors.slice(0, 3).map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {detail ? (
        <div className={detail.baseGraph ? 'grid gap-2 sm:grid-cols-2' : 'grid gap-2'}>
          {detail.baseGraph ? <GraphPreview label="Current" graph={detail.baseGraph} /> : null}
          <GraphPreview label="Proposed" graph={detail.proposedGraph} />
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground">Loading durable graph preview…</p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {!result.validation.valid ? (
          disabled ? (
            <Button type="button" size="sm" className="h-7 gap-1.5 px-2 text-[11px]" disabled>
              <WandSparkles className="h-3 w-3" />
              Revise with Operator
            </Button>
          ) : (
            <Button asChild size="sm" className="h-7 gap-1.5 px-2 text-[11px]">
              <Link to={revisionPath} state={revisionNavigationState}>
                <WandSparkles className="h-3 w-3" />
                Revise with Operator
              </Link>
            </Button>
          )
        ) : null}
        <Button asChild variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-[11px]">
          <Link to={builderPath}>
            <ExternalLink className="h-3 w-3" />
            Open in Builder
          </Link>
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-7 gap-1.5 px-2 text-[11px]"
          disabled={applied || disabled || !result.validation.valid}
          title={
            applied
              ? 'This draft is already saved as an immutable workflow version'
              : result.validation.valid
                ? 'Save this draft as a new immutable workflow version'
                : 'Resolve validation errors before saving'
          }
          onClick={() => onApply(result)}
        >
          {applied ? (
            <>
              <Check className="h-3 w-3" />
              Saved
            </>
          ) : (
            <>
              <Save className="h-3 w-3" />
              Save version
              <ArrowRight className="h-3 w-3" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
