import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorBanner } from '@/components/ui/error-banner';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { useFindingDetailQuery } from '@/hooks/queries/useFindingsQueries';
import { SeverityBadge } from '@/features/findings/SeverityBadge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FindingDetailSheetProps {
  findingId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2 py-1.5 text-sm">
      <span className="text-muted-foreground font-medium">{label}</span>
      <span className="break-all">{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FindingDetailSheet({ findingId, isOpen, onClose }: FindingDetailSheetProps) {
  const { data: finding, isLoading, error } = useFindingDetailQuery(findingId);
  const [isRawExpanded, setIsRawExpanded] = useState(false);

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Finding Details</SheetTitle>
          <SheetDescription>{finding?.name ?? 'Loading finding details…'}</SheetDescription>
        </SheetHeader>

        {/* Loading */}
        {isLoading && (
          <div className="space-y-4 mt-6" aria-busy="true">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mt-6">
            <ErrorBanner message={error.message ?? 'Failed to load finding details'} />
          </div>
        )}

        {/* Content */}
        {finding && (
          <div className="mt-6 space-y-6">
            {/* Overview */}
            <section>
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Overview
              </h4>
              <div className="divide-y">
                <DetailRow label="Severity">
                  <SeverityBadge severity={finding.severity} />
                </DetailRow>
                <DetailRow label="Name">{finding.name ?? '—'}</DetailRow>
                <DetailRow label="Timestamp">{formatTimestamp(finding.timestamp)}</DetailRow>
                <DetailRow label="Asset">{finding.asset_key ?? '—'}</DetailRow>
              </div>
            </section>

            {/* Source */}
            <section>
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Source
              </h4>
              <div className="divide-y">
                <DetailRow label="Workflow">{finding.workflow_name ?? '—'}</DetailRow>
                <DetailRow label="Workflow ID">
                  <span className="font-mono text-xs">{finding.workflow_id ?? '—'}</span>
                </DetailRow>
                <DetailRow label="Run ID">
                  <span className="font-mono text-xs">{finding.run_id ?? '—'}</span>
                </DetailRow>
                <DetailRow label="Component">
                  <span className="font-mono text-xs">{finding.component_id ?? '—'}</span>
                </DetailRow>
                <DetailRow label="Node Ref">
                  <span className="font-mono text-xs">{finding.node_ref ?? '—'}</span>
                </DetailRow>
              </div>
            </section>

            {/* Raw Data */}
            <section>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start px-0 font-semibold text-muted-foreground uppercase tracking-wider text-sm"
                onClick={() => setIsRawExpanded((prev) => !prev)}
                aria-expanded={isRawExpanded}
              >
                {isRawExpanded ? (
                  <ChevronDown className="h-4 w-4 mr-1" />
                ) : (
                  <ChevronRight className="h-4 w-4 mr-1" />
                )}
                Raw Data
              </Button>
              {isRawExpanded && (
                <pre className="mt-2 rounded-md bg-muted p-4 text-xs font-mono overflow-x-auto max-h-96">
                  {JSON.stringify(finding.raw, null, 2)}
                </pre>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
