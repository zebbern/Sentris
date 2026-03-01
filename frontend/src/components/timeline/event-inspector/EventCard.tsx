import { ChevronDown, FileText, Wrench } from 'lucide-react';
import { ExecutionErrorView } from '@/components/workflow/ExecutionErrorView';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { createPreview } from '@/utils/textPreview';
import { cn } from '@/lib/utils';
import { EVENT_ICONS, EVENT_ICON_TONE, LEVEL_BADGE, EVENT_LAYOUT_PRESETS } from './constants';
import { normalizeEventPayload, formatTimestamp, formatData } from './utils';
import type { EventCardProps } from './types';

export function EventCard({
  event,
  isExpanded,
  isSelected,
  isCurrent: _isCurrent,
  isRecentLiveEvent,
  isCurrentReplayEvent,
  layoutVariant,
  onToggle,
  onOpenFullMessage,
  onOpenDiagnostics,
}: EventCardProps) {
  const IconComponent = EVENT_ICONS[event.type] || FileText;
  const messagePreview = event.message
    ? createPreview(event.message, { charLimit: 220, lineLimit: 6 })
    : null;
  const messagePreviewText = messagePreview
    ? messagePreview.truncated
      ? `${messagePreview.text.trimEnd()}\n…`
      : messagePreview.text
    : '';
  const trimmedMessage = typeof event.message === 'string' ? event.message.trim() : '';
  const expandedMessage = trimmedMessage || messagePreviewText;
  const shouldShowFullMessageButton = Boolean(
    trimmedMessage && (messagePreview?.truncated || trimmedMessage.length > 320),
  );
  const normalizedPayload = normalizeEventPayload(event.data);
  const hasExpandableContent = Boolean(normalizedPayload || messagePreview?.truncated);
  const preset = EVENT_LAYOUT_PRESETS[layoutVariant];

  return (
    <li
      data-event-id={event.id}
      className={cn(
        'transition-colors relative',
        preset.li,
        // Left edge highlight based on event type (for stacked-rail layout)
        layoutVariant === 'stacked-rail' && event.type === 'FAILED' && 'border-l-rose-400/80',
        layoutVariant === 'stacked-rail' && event.type === 'COMPLETED' && 'border-l-emerald-400/80',
        layoutVariant === 'stacked-rail' && event.type === 'PROGRESS' && 'border-l-sky-400/80',
        layoutVariant === 'stacked-rail' && event.type === 'STARTED' && 'border-l-violet-300/80',
        // Left edge highlight for current/selected events (for all layouts)
        layoutVariant !== 'stacked-rail' && (isCurrentReplayEvent || isSelected) && 'border-l-4',
        layoutVariant !== 'stacked-rail' && isCurrentReplayEvent && 'border-l-blue-500',
        layoutVariant !== 'stacked-rail' &&
          isSelected &&
          !isCurrentReplayEvent &&
          'border-l-primary',
        layoutVariant !== 'stacked-rail' && isRecentLiveEvent && 'border-l-4 border-l-red-500',
        // Background highlighting
        isSelected ? 'bg-muted/60' : 'hover:bg-muted/50',
      )}
    >
      <div
        className={cn(
          'relative flex w-full items-start justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition',
          preset.button,
          !hasExpandableContent && 'cursor-default',
        )}
        role={hasExpandableContent ? 'button' : undefined}
        tabIndex={hasExpandableContent ? 0 : -1}
        onClick={() => hasExpandableContent && onToggle(event, hasExpandableContent)}
        onKeyDown={(e) => {
          if (!hasExpandableContent) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle(event, hasExpandableContent);
          }
        }}
      >
        <div className="flex flex-1 items-start gap-3 relative z-10">
          <div
            className={cn(
              'flex items-center justify-center rounded-full border bg-background relative shrink-0 transition-colors',
              preset.iconWrap,
              EVENT_ICON_TONE[event.type] ?? 'text-slate-600 border-border',
            )}
          >
            <IconComponent className="h-4 w-4" />
          </div>
          <div className="flex-1 space-y-1 overflow-hidden">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn(preset.title)}>{event.type}</span>
              <Badge
                variant={LEVEL_BADGE[event.level] ?? 'secondary'}
                className="text-[10px] font-medium text-muted-foreground bg-muted/40"
              >
                {event.level ?? 'info'}
              </Badge>
              {typeof event.metadata?.attempt === 'number' && (
                <span className="rounded-full bg-muted px-2 py-[2px] text-[10px] text-muted-foreground">
                  Attempt {event.metadata.attempt}
                </span>
              )}
            </div>
            <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', preset.meta)}>
              <span className="font-mono text-[11px]">{formatTimestamp(event.timestamp)}</span>
              {event.nodeId && (
                <span className="truncate text-muted-foreground">Node {event.nodeId}</span>
              )}
              {event.metadata?.activityId && (
                <span className="truncate font-mono text-[10px] text-muted-foreground/80">
                  {event.metadata.activityId}
                </span>
              )}
            </div>
            {(messagePreviewText || expandedMessage) && (
              <p
                className={cn(
                  'break-words text-[13px] text-muted-foreground/80 leading-snug',
                  preset.message,
                  isExpanded
                    ? 'line-clamp-none whitespace-pre-wrap max-h-36 overflow-auto pr-1'
                    : 'line-clamp-2',
                )}
              >
                {isExpanded ? expandedMessage : messagePreviewText}
              </p>
            )}
            {isExpanded && shouldShowFullMessageButton && (
              <button
                type="button"
                className="text-[11px] font-medium text-primary hover:text-primary/80"
                onClick={() => onOpenFullMessage(event.message!, event)}
              >
                Read full log
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenDiagnostics(event.id);
                  }}
                  className="flex items-center justify-center rounded-md border border-border/60 bg-muted/20 p-1.5 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground cursor-pointer"
                  role="button"
                  tabIndex={0}
                  aria-label="View diagnostics"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      onOpenDiagnostics(event.id);
                    }
                  }}
                >
                  <Wrench className="h-3.5 w-3.5" />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>Diagnostics</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        {hasExpandableContent && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(event, hasExpandableContent);
            }}
            className="absolute bottom-2 right-2 z-20 flex items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            <ChevronDown
              className={cn('h-4 w-4 transition-transform', isExpanded && 'rotate-180')}
            />
          </button>
        )}
      </div>

      {isExpanded && (normalizedPayload || event.error) && (
        <div className="mt-3 space-y-4 rounded-md border bg-background/80 p-3 text-xs">
          {event.error && (
            <section>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
                Error Details
              </div>
              <ExecutionErrorView error={event.error} />
            </section>
          )}
          {normalizedPayload && (
            <section>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Payload
              </div>
              <pre className="mt-2 max-h-52 overflow-auto rounded-md bg-muted/20 px-3 py-2 font-mono text-[11px]">
                {formatData(normalizedPayload)}
              </pre>
            </section>
          )}
        </div>
      )}
    </li>
  );
}
