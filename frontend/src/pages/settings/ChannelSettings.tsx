import { useState } from 'react';
import { Bell, Edit2, FlaskConical, History, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBanner } from '@/components/ui/error-banner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/use-toast';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import {
  useNotificationChannels,
  useDeleteNotificationChannel,
  useTestNotificationChannel,
  useToggleNotificationChannel,
} from '@/hooks/queries/useNotificationChannelQueries';
import { humanizeApiError } from '@/lib/humanizeApiError';
import type { NotificationChannel } from '@sentris/shared';

import { AddChannelDialog } from './AddChannelDialog';
import { ChannelDeliveryHistory } from './ChannelDeliveryHistory';

const TYPE_LABELS: Record<string, string> = {
  slack: 'Slack',
  email: 'Email',
  pagerduty: 'PagerDuty',
};

const EVENT_SHORT_LABELS: Record<string, string> = {
  'run.completed': 'Completed',
  'run.failed': 'Failed',
  'run.cancelled': 'Cancelled',
  'run.timed_out': 'Timed Out',
};

export function ChannelSettings() {
  useDocumentTitle('Settings · Channels');

  const { data: channels, isLoading, error, refetch } = useNotificationChannels();
  const { toast } = useToast();

  const deleteMutation = useDeleteNotificationChannel();
  const testMutation = useTestNotificationChannel();
  const toggleMutation = useToggleNotificationChannel();

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editChannel, setEditChannel] = useState<NotificationChannel | undefined>();

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<NotificationChannel | null>(null);

  // Delivery history state
  const [historyChannel, setHistoryChannel] = useState<NotificationChannel | null>(null);

  const handleAdd = () => {
    setEditChannel(undefined);
    setDialogOpen(true);
  };

  const handleEdit = (channel: NotificationChannel) => {
    setEditChannel(channel);
    setDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      toast({ title: 'Channel deleted', description: `"${deleteTarget.name}" has been deleted.` });
    } catch (err) {
      toast({ title: 'Delete failed', description: humanizeApiError(err) });
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleTest = async (channel: NotificationChannel) => {
    try {
      await testMutation.mutateAsync(channel.id);
      toast({
        title: 'Test sent',
        description: `A test notification was sent to "${channel.name}".`,
      });
    } catch (err) {
      toast({ title: 'Test failed', description: humanizeApiError(err) });
    }
  };

  const handleToggle = async (channel: NotificationChannel) => {
    const willBeActive = channel.status === 'inactive';
    try {
      await toggleMutation.mutateAsync({ id: channel.id, currentStatus: channel.status });
      toast({
        title: willBeActive ? 'Channel activated' : 'Channel deactivated',
        description: `"${channel.name}" is now ${willBeActive ? 'active' : 'inactive'}.`,
      });
    } catch (err) {
      toast({ title: 'Toggle failed', description: humanizeApiError(err) });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Notification Channels</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Configure channels to receive notifications when workflow runs complete, fail, or time
            out.
          </p>
        </div>
        <Button onClick={handleAdd} aria-label="Add notification channel">
          <Plus className="mr-2 h-4 w-4" />
          Add Channel
        </Button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3" role="status" aria-label="Loading channels">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border p-4 flex items-center gap-4">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-16 ml-auto" />
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && <ErrorBanner message={humanizeApiError(error)} onRetry={() => refetch()} />}

      {/* Empty */}
      {!isLoading && !error && channels?.length === 0 && (
        <EmptyState
          icon={Bell}
          title="No channels configured"
          description="Add a notification channel to start receiving alerts about your workflow runs."
          action={
            <Button onClick={handleAdd} variant="outline">
              <Plus className="mr-2 h-4 w-4" />
              Add Channel
            </Button>
          }
        />
      )}

      {/* Channel list */}
      {channels && channels.length > 0 && (
        <div className="space-y-3" role="list" aria-label="Notification channels">
          {channels.map((channel) => (
            <div
              key={channel.id}
              role="listitem"
              className="rounded-lg border p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
            >
              {/* Left: info */}
              <div className="flex flex-col gap-1.5 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm truncate">{channel.name}</span>
                  <Badge variant="outline" className="text-xs">
                    {TYPE_LABELS[channel.type] ?? channel.type}
                  </Badge>
                  <Badge variant={channel.status === 'active' ? 'success' : 'secondary'}>
                    {channel.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  {channel.events.map((event) => (
                    <Badge key={event} variant="outline" className="text-xs font-normal">
                      {EVENT_SHORT_LABELS[event] ?? event}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Right: actions */}
              <TooltipProvider delayDuration={300}>
                <div className="flex items-center gap-1 shrink-0">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEdit(channel)}
                        aria-label={`Edit ${channel.name}`}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Edit</TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleTest(channel)}
                        disabled={testMutation.isPending}
                        aria-label={`Test ${channel.name}`}
                      >
                        <FlaskConical className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Send test</TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleToggle(channel)}
                        disabled={toggleMutation.isPending}
                        aria-label={`${channel.status === 'active' ? 'Deactivate' : 'Activate'} ${channel.name}`}
                      >
                        <span
                          className={`inline-block h-2.5 w-2.5 rounded-full ${
                            channel.status === 'active' ? 'bg-green-500' : 'bg-muted-foreground/40'
                          }`}
                        />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {channel.status === 'active' ? 'Deactivate' : 'Activate'}
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setHistoryChannel(channel)}
                        aria-label={`View delivery history for ${channel.name}`}
                      >
                        <History className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Delivery history</TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteTarget(channel)}
                        aria-label={`Delete ${channel.name}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Delete</TooltipContent>
                  </Tooltip>
                </div>
              </TooltipProvider>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <AddChannelDialog open={dialogOpen} onOpenChange={setDialogOpen} channel={editChannel} />

      {/* Delivery History Sheet */}
      {historyChannel && (
        <ChannelDeliveryHistory
          channelId={historyChannel.id}
          channelName={historyChannel.name}
          open={Boolean(historyChannel)}
          onOpenChange={(open) => {
            if (!open) setHistoryChannel(null);
          }}
        />
      )}

      {/* Delete Confirmation */}
      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Channel</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &ldquo;{deleteTarget?.name}&rdquo;? This action cannot
              be undone. All delivery history for this channel will also be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
