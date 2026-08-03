import { Loader2, Sparkles } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  createOperatorDirectCommandNavigationState,
  createOperatorImproveRunNavigationState,
} from './operatorHandoff';
import { OperatorRunComparisonCard } from './OperatorRunComparisonCard';
import type { ProjectedOperatorRunImprovement } from './operatorRunImprovement';

const STAGE_LABELS: Record<ProjectedOperatorRunImprovement['stage'], string> = {
  queued: 'Queued',
  inspecting: 'Inspecting source evidence',
  proposing: 'Drafting a focused improvement',
  awaiting_approval: 'Waiting for approval',
  applying: 'Applying the approved revision',
  rerunning: 'Running the candidate workflow',
  comparing: 'Comparing source and candidate',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function OperatorRunImprovementPanel({
  improvement,
}: {
  improvement: ProjectedOperatorRunImprovement;
}) {
  const navigate = useNavigate();
  const active = ['queued', 'running', 'awaiting_approval'].includes(improvement.status);
  const summary = improvement.summary?.replace(/\s+/g, ' ').trim();

  return (
    <div className="border-b px-3 py-2">
      <div className="rounded-md border border-primary/20 bg-primary/5 p-2.5">
        <div className="flex items-center gap-2">
          {active ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden="true" />
          ) : (
            <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          )}
          <span className="text-xs font-medium">Operator improvement</span>
          <Badge variant="outline" className="ml-auto h-5 px-1.5 text-[10px]">
            {STAGE_LABELS[improvement.stage]}
          </Badge>
        </div>

        {summary ? (
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            {summary.length > 220 ? `${summary.slice(0, 217)}…` : summary}
          </p>
        ) : null}
        {improvement.error ? (
          <p className="mt-2 text-[11px] text-destructive">{improvement.error}</p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            asChild
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
          >
            <Link to={`/operator/${improvement.sessionId}`}>Open Operator</Link>
          </Button>
          {improvement.candidateRunId ? (
            <Button
              asChild
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px]"
            >
              <Link to={`/runs/${encodeURIComponent(improvement.candidateRunId)}`}>
                View candidate
              </Link>
            </Button>
          ) : null}
        </div>

        {improvement.comparison ? (
          <details className="mt-2 border-t border-border/60 pt-2">
            <summary className="cursor-pointer text-[11px] font-medium text-primary">
              View recorded comparison
            </summary>
            <div className="mt-2">
              <OperatorRunComparisonCard
                result={improvement.comparison}
                disabled={active}
                kept={improvement.kept}
                onCommand={(request) => {
                  if (request.directCommand) {
                    navigate(`/operator/${improvement.sessionId}`, {
                      state: createOperatorDirectCommandNavigationState(
                        request.message,
                        request.directCommand,
                        `/runs/${improvement.sourceRunId}`,
                      ),
                    });
                  } else if (request.journey?.kind === 'improve_run') {
                    navigate(`/operator/${improvement.sessionId}`, {
                      state: createOperatorImproveRunNavigationState(
                        request.journey.sourceRunId,
                        `/runs/${request.journey.sourceRunId}`,
                      ),
                    });
                  }
                }}
              />
            </div>
          </details>
        ) : null}
      </div>
    </div>
  );
}
