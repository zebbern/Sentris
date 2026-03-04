import { ExternalLink } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useFindingTicket } from '@/hooks/queries/useTicketingQueries';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LinkedTicketProps {
  findingId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    return `${diffDays}d ago`;
  } catch {
    return dateStr;
  }
}

const SYNC_STATUS_VARIANTS: Record<string, { className: string; label: string }> = {
  synced: { className: 'bg-green-600 hover:bg-green-600 text-white', label: 'Synced' },
  pending: { className: 'bg-yellow-500 hover:bg-yellow-500 text-white', label: 'Pending' },
  error: { className: 'bg-red-600 hover:bg-red-600 text-white', label: 'Error' },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LinkedTicket({ findingId }: LinkedTicketProps) {
  const { data: ticket, isLoading, isError } = useFindingTicket(findingId);

  // Loading state — show a small skeleton to reserve space (CLS)
  if (isLoading) {
    return (
      <div className="space-y-1.5" aria-busy="true">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-5 w-32" />
      </div>
    );
  }

  // No ticket linked (404 or error) — show nothing
  if (isError || !ticket) {
    return null;
  }

  const syncVariant = SYNC_STATUS_VARIANTS[ticket.syncStatus] ?? SYNC_STATUS_VARIANTS.pending;

  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
        Linked Ticket
      </label>
      <div className="flex items-center gap-2 flex-wrap">
        <a
          href={ticket.externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
        >
          {ticket.externalId}
          <ExternalLink className="h-3 w-3" />
        </a>
        <Badge variant="default" className={`text-xs ${syncVariant.className}`}>
          {syncVariant.label}
        </Badge>
        {ticket.lastSyncedAt && (
          <span className="text-xs text-muted-foreground">
            {formatRelativeTime(ticket.lastSyncedAt)}
          </span>
        )}
      </div>
    </div>
  );
}
