import { useCallback, useEffect, useState } from 'react';
import type {
  NotificationChannel,
  NotificationEventType,
  UpdateNotificationChannel,
} from '@sentris/shared';
import { NOTIFICATION_EVENT_TYPES } from '@sentris/shared';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import {
  useCreateNotificationChannel,
  useUpdateNotificationChannel,
} from '@/hooks/queries/useNotificationChannelQueries';
import { humanizeApiError } from '@/lib/humanizeApiError';

interface AddChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel?: NotificationChannel;
}

type ChannelType = 'slack' | 'email' | 'pagerduty';

const EVENT_LABELS: Record<NotificationEventType, string> = {
  'run.completed': 'Run Completed',
  'run.failed': 'Run Failed',
  'run.cancelled': 'Run Cancelled',
  'run.timed_out': 'Run Timed Out',
};

const CHANNEL_TYPE_LABELS: Record<ChannelType, string> = {
  slack: 'Slack',
  email: 'Email',
  pagerduty: 'PagerDuty',
};

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function AddChannelDialog({ open, onOpenChange, channel }: AddChannelDialogProps) {
  const isEditMode = Boolean(channel);
  const { toast } = useToast();
  const createMutation = useCreateNotificationChannel();
  const updateMutation = useUpdateNotificationChannel();

  const [name, setName] = useState('');
  const [type, setType] = useState<ChannelType>('slack');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<NotificationEventType[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset form state when dialog opens/closes or channel changes
  useEffect(() => {
    if (open) {
      if (channel) {
        setName(channel.name);
        setType(channel.type);
        setWebhookUrl('');
        setSelectedEvents([...channel.events]);
      } else {
        setName('');
        setType('slack');
        setWebhookUrl('');
        setSelectedEvents([]);
      }
      setErrors({});
    }
  }, [open, channel]);

  const toggleEvent = useCallback((event: NotificationEventType) => {
    setSelectedEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    );
  }, []);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = 'Name is required';
    }

    if (type === 'slack') {
      if (!isEditMode && !webhookUrl.trim()) {
        newErrors.webhookUrl = 'Webhook URL is required';
      }
      if (webhookUrl.trim() && !isValidUrl(webhookUrl.trim())) {
        newErrors.webhookUrl = 'Must be a valid URL';
      }
    }

    if (selectedEvents.length === 0) {
      newErrors.events = 'Select at least one event';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    try {
      if (isEditMode && channel) {
        const payload: UpdateNotificationChannel = {
          name: name.trim(),
          events: selectedEvents,
        };
        if (type === 'slack' && webhookUrl.trim()) {
          payload.config = { webhookUrl: webhookUrl.trim() };
        }
        await updateMutation.mutateAsync({
          id: channel.id,
          payload,
        });
        toast({ title: 'Channel updated', description: `"${name}" has been updated.` });
      } else {
        const config: Record<string, unknown> =
          type === 'slack' ? { webhookUrl: webhookUrl.trim() } : {};
        await createMutation.mutateAsync({
          name: name.trim(),
          type,
          config,
          events: selectedEvents,
        });
        toast({ title: 'Channel created', description: `"${name}" has been created.` });
      }
      onOpenChange(false);
    } catch (err) {
      toast({
        title: isEditMode ? 'Update failed' : 'Creation failed',
        description: humanizeApiError(err),
      });
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const isComingSoon = type === 'email' || type === 'pagerduty';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Edit Channel' : 'Add Channel'}</DialogTitle>
          <DialogDescription>
            {isEditMode
              ? 'Update your notification channel settings.'
              : 'Configure a new notification channel to receive alerts.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="channel-name">Name</Label>
            <Input
              id="channel-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Security Alerts"
              aria-describedby={errors.name ? 'channel-name-error' : undefined}
              aria-invalid={Boolean(errors.name)}
            />
            {errors.name && (
              <p id="channel-name-error" className="text-xs text-destructive">
                {errors.name}
              </p>
            )}
          </div>

          {/* Type */}
          <div className="space-y-2">
            <Label htmlFor="channel-type">Type</Label>
            <Select
              value={type}
              onValueChange={(v) => setType(v as ChannelType)}
              disabled={isEditMode}
            >
              <SelectTrigger id="channel-type" aria-label="Channel type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CHANNEL_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isEditMode && (
              <p className="text-xs text-muted-foreground">
                Channel type cannot be changed after creation.
              </p>
            )}
          </div>

          {/* Coming soon notice for Email / PagerDuty */}
          {isComingSoon && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
              Coming soon — only Slack is fully supported.
            </div>
          )}

          {/* Slack config */}
          {type === 'slack' && (
            <div className="space-y-2">
              <Label htmlFor="channel-webhook-url">Webhook URL</Label>
              <Input
                id="channel-webhook-url"
                type="url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder={
                  isEditMode
                    ? 'Enter new URL to replace current'
                    : 'https://hooks.slack.com/services/...'
                }
                aria-describedby={
                  errors.webhookUrl ? 'channel-webhook-url-error' : 'channel-webhook-url-hint'
                }
                aria-invalid={Boolean(errors.webhookUrl)}
              />
              {isEditMode && (
                <p id="channel-webhook-url-hint" className="text-xs text-muted-foreground">
                  Current URL is masked for security. Enter a new URL only if you want to replace
                  it.
                </p>
              )}
              {errors.webhookUrl && (
                <p id="channel-webhook-url-error" className="text-xs text-destructive">
                  {errors.webhookUrl}
                </p>
              )}
            </div>
          )}

          {/* Events */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium leading-none">Events</legend>
            <div className="grid grid-cols-2 gap-2">
              {NOTIFICATION_EVENT_TYPES.map((event) => (
                <label key={event} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={selectedEvents.includes(event)}
                    onCheckedChange={() => toggleEvent(event)}
                    aria-label={EVENT_LABELS[event]}
                  />
                  {EVENT_LABELS[event]}
                </label>
              ))}
            </div>
            {errors.events && (
              <p className="text-xs text-destructive" role="alert">
                {errors.events}
              </p>
            )}
          </fieldset>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || isComingSoon}>
              {isSubmitting
                ? isEditMode
                  ? 'Updating…'
                  : 'Creating…'
                : isEditMode
                  ? 'Update'
                  : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
