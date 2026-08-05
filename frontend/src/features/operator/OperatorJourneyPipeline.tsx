import {
  Check,
  CircleDot,
  GitCompareArrows,
  Loader2,
  Play,
  Save,
  Scale,
  Search,
  Sparkles,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type {
  OperatorJourneyStageId,
  OperatorJourneyStageState,
  ProjectedOperatorJourneyPipeline,
} from './operatorJourneyPipelineProjector';

const STAGE_ICONS: Record<OperatorJourneyStageId, LucideIcon> = {
  inspect: Search,
  draft: Sparkles,
  save: Save,
  run: Play,
  compare: GitCompareArrows,
  decision: Scale,
};

const STATE_STYLES: Record<OperatorJourneyStageState, string> = {
  pending: 'border-border bg-background text-muted-foreground',
  active: 'border-blue-500/50 bg-blue-500/10 text-blue-500',
  attention: 'border-amber-500/50 bg-amber-500/10 text-amber-500',
  completed: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-500',
  failed: 'border-destructive/50 bg-destructive/10 text-destructive',
};

const STATE_LABELS: Record<OperatorJourneyStageState, string> = {
  pending: 'Pending',
  active: 'Running',
  attention: 'Action needed',
  completed: 'Completed',
  failed: 'Failed',
};

function stateIcon(state: OperatorJourneyStageState, Icon: LucideIcon) {
  if (state === 'completed') return <Check className="h-3.5 w-3.5" aria-hidden="true" />;
  if (state === 'failed') return <X className="h-3.5 w-3.5" aria-hidden="true" />;
  if (state === 'active') {
    return <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" />;
  }
  if (state === 'attention') {
    return <CircleDot className="h-3.5 w-3.5" aria-hidden="true" />;
  }
  return <Icon className="h-3.5 w-3.5" aria-hidden="true" />;
}

function pipelineStatus(pipeline: ProjectedOperatorJourneyPipeline): string {
  if (pipeline.stages.some((stage) => stage.state === 'failed')) return 'Needs attention';
  if (pipeline.stages[pipeline.stages.length - 1]?.state === 'completed') return 'Kept';
  if (pipeline.stages.some((stage) => stage.state === 'attention')) return 'Action needed';
  if (pipeline.stages.some((stage) => stage.state === 'active')) return 'Live';
  return 'Recorded';
}

export function OperatorJourneyPipeline({
  pipeline,
}: {
  pipeline: ProjectedOperatorJourneyPipeline;
}) {
  return (
    <section
      aria-label="Improvement pipeline"
      className="mb-4 overflow-hidden rounded-2xl border border-border/70 bg-background/75 shadow-[0_10px_32px_rgba(0,0,0,0.2)]"
    >
      <div className="flex min-h-11 flex-wrap items-center gap-2 border-b border-border/50 px-4 py-2.5">
        <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
        <h2 className="text-xs font-semibold">Improvement pipeline</h2>
        <div className="ml-auto flex items-center gap-1.5">
          <Link
            aria-label="Source run"
            to={`/runs/${encodeURIComponent(pipeline.sourceRunId)}`}
            className="text-[10px] text-muted-foreground transition-colors hover:text-primary"
          >
            Source run
          </Link>
          {pipeline.candidateRunId ? (
            <>
              <span className="text-[10px] text-border" aria-hidden="true">
                /
              </span>
              <Link
                aria-label="Candidate run"
                to={`/runs/${encodeURIComponent(pipeline.candidateRunId)}`}
                className="text-[10px] text-muted-foreground transition-colors hover:text-primary"
              >
                Candidate run
              </Link>
            </>
          ) : null}
          <Badge variant="outline" className="ml-1 h-5 px-1.5 text-[10px]">
            {pipelineStatus(pipeline)}
          </Badge>
        </div>
      </div>

      <div className="px-2 py-1.5">
        <ol aria-live="polite">
          {pipeline.stages.map((stage, index) => {
            const Icon = STAGE_ICONS[stage.id];
            return (
              <li
                key={stage.id}
                className={cn(
                  'relative grid grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-2 px-2 py-2',
                  stage.state === 'active' && 'bg-blue-500/[0.035]',
                  stage.state === 'attention' && 'bg-amber-500/[0.035]',
                )}
              >
                {index < pipeline.stages.length - 1 ? (
                  <span
                    className={cn(
                      'absolute bottom-[-8px] left-[18.5px] top-7 w-px',
                      stage.state === 'completed' ? 'bg-emerald-500/40' : 'bg-border',
                    )}
                    aria-hidden="true"
                  />
                ) : null}
                <span
                  className={cn(
                    'relative z-10 flex h-5 w-5 items-center justify-center rounded-full border',
                    STATE_STYLES[stage.state],
                  )}
                  aria-current={stage.state === 'active' ? 'step' : undefined}
                >
                  {stateIcon(stage.state, Icon)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">{stage.label}</span>
                  <span
                    className={cn(
                      'mt-0.5 block truncate text-[10px] text-muted-foreground',
                      stage.state === 'attention' && 'text-amber-600 dark:text-amber-300',
                      stage.state === 'failed' && 'text-destructive',
                    )}
                    title={stage.detail}
                  >
                    {stage.detail}
                  </span>
                </span>
                <span className="pt-0.5 text-[10px] font-medium text-muted-foreground">
                  {STATE_LABELS[stage.state]}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
