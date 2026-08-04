import type {
  OperatorListWorkflowsResult,
  OperatorWorkflowInspectionResult,
} from '@sentris/shared';
import { Play } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import type { OperatorWorkflowRunSelection } from './OperatorWorkflowRunDialog';

type OperatorSavedWorkflowCardProps =
  | {
      kind: 'list';
      result: OperatorListWorkflowsResult;
      disabled: boolean;
      onRun: (workflow: OperatorWorkflowRunSelection) => void;
    }
  | {
      kind: 'inspection';
      result: OperatorWorkflowInspectionResult;
      disabled: boolean;
      onRun: (workflow: OperatorWorkflowRunSelection) => void;
    };

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

export function OperatorSavedWorkflowCard(props: OperatorSavedWorkflowCardProps) {
  const workflows =
    props.kind === 'list'
      ? props.result.map((workflow) => ({
          selection: { workflowId: workflow.id, name: workflow.name },
          description: workflow.description,
          metadata: `${countLabel(workflow.nodeCount, 'node')} · ${countLabel(workflow.runCount, 'run')}`,
        }))
      : [
          {
            selection: {
              workflowId: props.result.id,
              name: props.result.name,
              versionId: props.result.versionId,
              version: props.result.version,
            },
            description: props.result.description,
            metadata: `Version ${props.result.version} · ${countLabel(props.result.nodeCount, 'node')} · ${countLabel(props.result.runtimeInputs.length, 'input')}`,
          },
        ];

  if (workflows.length === 0) {
    return <p className="text-xs text-muted-foreground">No saved workflows matched.</p>;
  }

  return (
    <div className="max-h-72 space-y-1.5 overflow-y-auto">
      {workflows.map(({ selection, description, metadata }) => (
        <div
          key={`${selection.workflowId}:${'versionId' in selection ? selection.versionId : 'current'}`}
          className="flex items-center gap-3 rounded-md border border-border/70 bg-background/60 p-2.5"
        >
          <div className="min-w-0 flex-1">
            <Link
              to={`/workflows/${encodeURIComponent(selection.workflowId)}`}
              className="block truncate text-xs font-semibold text-foreground hover:text-primary"
            >
              {selection.name}
            </Link>
            {description ? (
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{description}</p>
            ) : null}
            <p className="mt-1 text-[10px] text-muted-foreground">{metadata}</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 shrink-0 gap-1.5 px-2 text-[11px]"
            disabled={props.disabled}
            aria-label={`Configure and run ${selection.name}`}
            onClick={() => props.onRun(selection)}
          >
            <Play className="h-3 w-3" aria-hidden="true" />
            Configure &amp; run
          </Button>
        </div>
      ))}
    </div>
  );
}
