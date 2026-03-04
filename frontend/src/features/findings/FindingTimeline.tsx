import { Clock, Users, Shield, FileText, Layers, AlertCircle } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { useFindingHistoryQuery } from '@/hooks/queries/useFindingsQueries';
import { TriageStatusBadge } from '@/features/findings/TriageStatusBadge';
import { TRIAGE_STATUS_META } from '@/features/findings/types';
import type { FindingTriageStatus, FindingTriageEventResponse } from '@/features/findings/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FindingTimelineProps {
  findingId: string;
}

interface TimelineEvent extends FindingTriageEventResponse {
  /** Populated by parent if member data is available */
  userName?: string;
  userAvatar?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(isoTimestamp: string): string {
  try {
    const date = new Date(isoTimestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSeconds < 60) return 'just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return isoTimestamp;
  }
}

function getEventIcon(eventType: string) {
  switch (eventType) {
    case 'status_change':
      return <Clock className="h-3.5 w-3.5" />;
    case 'assignment_change':
      return <Users className="h-3.5 w-3.5" />;
    case 'severity_override':
      return <Shield className="h-3.5 w-3.5" />;
    case 'note_added':
    case 'note_updated':
      return <FileText className="h-3.5 w-3.5" />;
    case 'bulk_update':
      return <Layers className="h-3.5 w-3.5" />;
    default:
      return <AlertCircle className="h-3.5 w-3.5" />;
  }
}

function getStatusLabel(value: string | null): string {
  if (!value) return 'unknown';
  const meta = TRIAGE_STATUS_META[value as FindingTriageStatus];
  return meta?.label ?? value;
}

function EventDescription({ event }: { event: TimelineEvent }) {
  switch (event.eventType) {
    case 'status_change':
      return (
        <span>
          Changed status from{' '}
          {event.oldValue && (
            <TriageStatusBadge
              status={event.oldValue as FindingTriageStatus}
              className="mx-0.5 text-[10px] px-1.5 py-0"
            />
          )}
          {' → '}
          {event.newValue && (
            <TriageStatusBadge
              status={event.newValue as FindingTriageStatus}
              className="mx-0.5 text-[10px] px-1.5 py-0"
            />
          )}
        </span>
      );

    case 'assignment_change':
      if (!event.newValue) {
        return <span>Unassigned the finding</span>;
      }
      return (
        <span>
          Assigned to <strong className="font-medium">{event.newValue}</strong>
        </span>
      );

    case 'severity_override':
      return (
        <span>
          Changed severity from{' '}
          <strong className="font-medium">{getStatusLabel(event.oldValue)}</strong>
          {' to '}
          <strong className="font-medium">{getStatusLabel(event.newValue)}</strong>
        </span>
      );

    case 'note_added':
      return <span>Added a note</span>;

    case 'note_updated':
      return <span>Updated the note</span>;

    case 'bulk_update':
      return <span>Updated via bulk action</span>;

    default:
      return (
        <span>
          {event.eventType}: {event.fieldChanged ?? 'unknown field'}
        </span>
      );
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TimelineEventItem({ event }: { event: TimelineEvent }) {
  return (
    <div className="relative flex gap-3 pb-6 last:pb-0">
      {/* Vertical line */}
      <div className="absolute left-[15px] top-8 bottom-0 w-px bg-border last:hidden" />

      {/* Icon circle */}
      <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground">
        {getEventIcon(event.eventType)}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pt-0.5">
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm leading-relaxed">
            <span className="flex items-center gap-1.5 mb-0.5">
              <Avatar className="h-4 w-4 inline-flex">
                {event.userAvatar && (
                  <AvatarImage src={event.userAvatar} alt={event.userName ?? 'User'} />
                )}
                <AvatarFallback className="text-[8px]">
                  {(event.userName ?? event.userId).slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="font-medium text-xs">
                {event.userName ?? event.userId.slice(0, 12)}
              </span>
            </span>
            <EventDescription event={event} />
          </div>

          <time
            className="text-xs text-muted-foreground whitespace-nowrap shrink-0"
            dateTime={event.createdAt}
            title={new Date(event.createdAt).toLocaleString()}
          >
            {formatRelativeTime(event.createdAt)}
          </time>
        </div>

        {/* Optional comment */}
        {event.comment && (
          <blockquote className="mt-1.5 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground italic border-l-2 border-primary/30">
            {event.comment}
          </blockquote>
        )}
      </div>
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="h-8 w-8 rounded-full shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FindingTimeline({ findingId }: FindingTimelineProps) {
  const { data: historyResponse, isLoading, error } = useFindingHistoryQuery(findingId);
  const events = historyResponse?.events ?? [];

  if (isLoading) {
    return <TimelineSkeleton />;
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive py-4">
        <AlertCircle className="h-4 w-4" />
        <span>Failed to load timeline</span>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center py-6 text-center">
        <Clock className="h-8 w-8 text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">No activity yet</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Status changes, assignments, and notes will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-0" role="list" aria-label="Finding activity timeline">
      {events.map((event) => (
        <TimelineEventItem key={event.id} event={event as TimelineEvent} />
      ))}
    </div>
  );
}
