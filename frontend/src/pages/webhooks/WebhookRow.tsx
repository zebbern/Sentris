import type { useSortable } from '@dnd-kit/sortable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { TableCell } from '@/components/ui/table';
import { DragHandle } from '@/components/ui/sortable';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ExternalLink, RotateCw, Trash2, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/utils/timeFormat';
import type { WebhookConfiguration } from '@sentris/shared';
import type { StatusBadgeProps } from '@/utils/tableHelpers';

export interface WebhookRowHandleProps {
  listeners: ReturnType<typeof useSortable>['listeners'];
  attributes: ReturnType<typeof useSortable>['attributes'];
}

export interface WebhookRowProps {
  webhook: WebhookConfiguration;
  handleProps: WebhookRowHandleProps;
  isSelected: boolean;
  isDragDisabled: boolean;
  workflowName: string;
  statusBadgeProps: StatusBadgeProps;
  isActionBusy: boolean;
  onToggle: () => void;
  onCopyUrl: (webhook: WebhookConfiguration) => void;
  onViewHistory: (webhook: WebhookConfiguration) => void;
  onRegeneratePath: (webhook: WebhookConfiguration) => void;
  onDelete: (webhook: WebhookConfiguration) => void;
}

export function WebhookRow({
  webhook,
  handleProps,
  isSelected,
  isDragDisabled,
  workflowName,
  statusBadgeProps,
  isActionBusy,
  onToggle,
  onCopyUrl,
  onViewHistory,
  onRegeneratePath,
  onDelete,
}: WebhookRowProps) {
  return (
    <>
      <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={isSelected}
          onCheckedChange={onToggle}
          aria-label={`Select ${webhook.name}`}
        />
      </TableCell>
      <DragHandle {...handleProps} disabled={isDragDisabled} />
      <TableCell className="font-medium">
        <div className="flex flex-col">
          <span className="truncate max-w-[140px]">{webhook.name}</span>
          {webhook.description && (
            <span className="text-xs text-muted-foreground truncate max-w-[140px]">
              {webhook.description}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <div className="flex flex-col">
          <span className="font-medium truncate max-w-[120px]">{workflowName}</span>
          <span className="text-xs text-muted-foreground truncate max-w-[120px]">
            {webhook.workflowId.slice(0, 8)}...
          </span>
        </div>
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <div className="flex items-center gap-1 max-w-[200px]">
          <code className="text-xs bg-muted px-1.5 py-0.5 rounded truncate flex-1">
            /{webhook.webhookPath.slice(0, 20)}...
          </code>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                aria-label="Copy webhook URL"
                onClick={(e) => {
                  e.stopPropagation();
                  onCopyUrl(webhook);
                }}
              >
                <Copy className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy webhook URL</TooltipContent>
          </Tooltip>
        </div>
      </TableCell>
      <TableCell className="text-sm hidden lg:table-cell whitespace-nowrap">
        {formatDateTime(webhook.createdAt)}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <Badge variant={statusBadgeProps.variant}>{statusBadgeProps.label}</Badge>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1 md:gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-1 h-8 px-2 md:px-3"
                onClick={(e) => {
                  e.stopPropagation();
                  onViewHistory(webhook);
                }}
              >
                <ExternalLink className="h-4 w-4" />
                <span className="hidden md:inline">History</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>View delivery history</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                aria-label="Regenerate URL"
                onClick={(e) => {
                  e.stopPropagation();
                  onRegeneratePath(webhook);
                }}
                disabled={isActionBusy}
                className="h-8 w-8"
              >
                <RotateCw className={cn('h-4 w-4', isActionBusy && 'animate-spin')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Regenerate webhook URL (old URL will stop working)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete webhook"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(webhook);
                }}
                disabled={isActionBusy}
                className="h-8 w-8"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete webhook</TooltipContent>
          </Tooltip>
        </div>
      </TableCell>
    </>
  );
}
