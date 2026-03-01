import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TableCell } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CheckCircle, XCircle, Clock, ExternalLink } from 'lucide-react';
import { SortableTableRow, DragHandle } from '@/components/ui/sortable';
import { getStatusBadgeClassFromStatus } from '@/utils/statusBadgeStyles';
import { formatDateTime, formatRelativeTime } from '@/utils/timeFormat';
import type { HumanInputRequest } from '@/components/workflow/HumanInputResolutionView';

const STATUS_ICONS: Record<string, typeof CheckCircle> = {
  pending: Clock,
  approved: CheckCircle,
  rejected: XCircle,
  expired: Clock,
  cancelled: XCircle,
};

interface ActionCenterRowProps {
  approval: HumanInputRequest;
  isDragDisabled: boolean;
  isActionBusy: boolean;
  onOpenResolveDialog: (approval: HumanInputRequest, action: 'approve' | 'reject' | 'view') => void;
}

function renderStatusBadge(approval: HumanInputRequest) {
  let status = approval.status as string;
  if (status === 'resolved' && approval.responseData?.status) {
    status = approval.responseData.status as string;
  }

  const label = status.charAt(0).toUpperCase() + status.slice(1);
  const Icon = STATUS_ICONS[status] || Clock;
  return (
    <Badge variant="outline" className={getStatusBadgeClassFromStatus(status, 'gap-1')}>
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
}

export function ActionCenterRow({
  approval,
  isDragDisabled,
  isActionBusy,
  onOpenResolveDialog,
}: ActionCenterRowProps) {
  const isPending = approval.status === 'pending';

  return (
    <SortableTableRow key={approval.id} id={approval.id} disabled={isDragDisabled}>
      {({ handleProps }) => (
        <>
          <DragHandle {...handleProps} disabled={isDragDisabled} />
          <TableCell className="font-medium">
            <div className="flex flex-col min-w-0">
              <span className="truncate">{approval.title}</span>
              {approval.description && (
                <span className="text-xs text-muted-foreground truncate">
                  {approval.description}
                </span>
              )}
            </div>
          </TableCell>
          <TableCell className="hidden md:table-cell">
            <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{approval.nodeRef}</code>
          </TableCell>
          <TableCell className="hidden lg:table-cell">
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href={`/workflows/${approval.workflowId}/runs/${approval.runId}`}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  {approval.runId.substring(0, 12)}...
                  <ExternalLink className="h-3 w-3" />
                </a>
              </TooltipTrigger>
              <TooltipContent>View run details</TooltipContent>
            </Tooltip>
          </TableCell>
          <TableCell className="text-sm hidden sm:table-cell whitespace-nowrap">
            {formatDateTime(approval.createdAt)}
          </TableCell>
          <TableCell className="text-sm hidden lg:table-cell whitespace-nowrap">
            {approval.timeoutAt ? (
              <span className={approval.status === 'pending' ? 'text-warning' : ''}>
                {formatRelativeTime(approval.timeoutAt)}
              </span>
            ) : (
              <span className="text-muted-foreground">No timeout</span>
            )}
          </TableCell>
          <TableCell className="hidden sm:table-cell">{renderStatusBadge(approval)}</TableCell>
          <TableCell className="text-right">
            <div className="flex items-center justify-end gap-2">
              {isPending ? (
                <>
                  {approval.inputType === 'approval' || approval.inputType === 'review' ? (
                    <>
                      <Button
                        variant="default"
                        size="sm"
                        className="gap-1 h-8"
                        onClick={() => onOpenResolveDialog(approval, 'approve')}
                        disabled={isActionBusy}
                      >
                        <CheckCircle className="h-4 w-4" />
                        Approve
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="gap-1 h-8"
                        onClick={() => onOpenResolveDialog(approval, 'reject')}
                        disabled={isActionBusy}
                      >
                        <XCircle className="h-4 w-4" />
                        Reject
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="default"
                      size="sm"
                      className="gap-1 h-8"
                      onClick={() => onOpenResolveDialog(approval, 'approve')}
                      disabled={isActionBusy}
                    >
                      {approval.inputType === 'acknowledge' ? 'Acknowledge' : 'Respond'}
                    </Button>
                  )}
                </>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 h-8"
                  onClick={() => onOpenResolveDialog(approval, 'view')}
                >
                  <ExternalLink className="h-4 w-4" />
                  View Details
                </Button>
              )}
            </div>
          </TableCell>
        </>
      )}
    </SortableTableRow>
  );
}
