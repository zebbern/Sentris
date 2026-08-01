import { AlertCircle, CheckCircle2, CircleAlert, LoaderCircle } from 'lucide-react';
import type { AgentReadinessRow } from './readiness';

export interface ReadinessSummaryProps {
  rows: readonly AgentReadinessRow[];
}

const iconByState = {
  ready: CheckCircle2,
  loading: LoaderCircle,
  'not-configured': AlertCircle,
  'needs-mapping': AlertCircle,
  degraded: CircleAlert,
  error: AlertCircle,
} as const;

export function ReadinessSummary({ rows }: ReadinessSummaryProps) {
  return (
    <div aria-label="Configuration readiness" className="space-y-1.5 rounded-md border p-2">
      {rows.map((row) => {
        const Icon = iconByState[row.state];
        return (
          <div key={row.kind} className="flex items-start gap-2 text-xs">
            <Icon
              aria-hidden="true"
              className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                row.state === 'ready'
                  ? 'text-primary'
                  : row.state === 'loading'
                    ? 'animate-spin text-muted-foreground'
                    : 'text-destructive'
              }`}
            />
            <span>
              <span className="font-medium">{row.label}.</span> {row.detail}
            </span>
          </div>
        );
      })}
    </div>
  );
}
