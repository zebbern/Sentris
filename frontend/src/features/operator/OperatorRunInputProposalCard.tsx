import type { OperatorRunInputProposalResult } from '@sentris/shared';
import { ArrowRight, Play } from 'lucide-react';

import { Button } from '@/components/ui/button';

import type { OperatorRunCommandRequest } from './OperatorRunActivity';

interface OperatorRunInputProposalCardProps {
  result: OperatorRunInputProposalResult;
  disabled: boolean;
  onCommand: (request: OperatorRunCommandRequest) => void;
}

function formatValue(value: unknown): string {
  if (value === undefined) return 'Not set';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export function OperatorRunInputProposalCard({
  result,
  disabled,
  onCommand,
}: OperatorRunInputProposalCardProps) {
  return (
    <div className="space-y-2.5 rounded-md border border-primary/25 bg-primary/[0.03] p-2.5">
      <div>
        <p className="text-xs font-semibold text-foreground">Reviewed input changes</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          The source scope and exact workflow version are preserved. Secret inputs remain unchanged.
        </p>
      </div>

      <div className="space-y-1.5">
        {result.changes.map((change) => (
          <div
            key={change.inputId}
            className="rounded border border-border/60 bg-background/60 px-2 py-1.5"
          >
            <div className="flex flex-wrap items-baseline gap-x-1.5 text-[11px]">
              <span className="font-medium text-foreground">{change.label}</span>
              <span className="font-mono text-[10px] text-muted-foreground">{change.inputId}</span>
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
              <code className="min-w-0 truncate rounded bg-muted/60 px-1 py-0.5 text-foreground">
                {formatValue(change.before)}
              </code>
              <ArrowRight className="h-3 w-3 shrink-0" aria-hidden="true" />
              <code className="min-w-0 truncate rounded bg-muted/60 px-1 py-0.5 text-foreground">
                {formatValue(change.after)}
              </code>
            </div>
          </div>
        ))}
      </div>

      <Button
        type="button"
        size="sm"
        className="h-8 gap-1.5 px-2.5 text-xs"
        disabled={disabled}
        onClick={() =>
          onCommand({
            message: `Run workflow version ${result.versionId} with the reviewed input changes from source run ${result.sourceRunId}`,
            directCommand: {
              commandName: 'run_workflow',
              arguments: {
                workflowId: result.workflowId,
                versionId: result.versionId,
                inputs: {},
                sourceRunId: result.sourceRunId,
                inputChanges: result.inputChanges,
              },
            },
          })
        }
      >
        <Play className="h-3.5 w-3.5" aria-hidden="true" />
        Run with changes
      </Button>
    </div>
  );
}
