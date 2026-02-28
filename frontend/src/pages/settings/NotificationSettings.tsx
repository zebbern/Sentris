import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useUserPreferencesStore } from '@/store/userPreferencesStore';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

interface NotificationOption {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}

export function NotificationSettings() {
  useDocumentTitle('Settings · Notifications');

  const notifyOnRunComplete = useUserPreferencesStore((s) => s.notifyOnRunComplete);
  const setNotifyOnRunComplete = useUserPreferencesStore((s) => s.setNotifyOnRunComplete);
  const notifyOnRunFailed = useUserPreferencesStore((s) => s.notifyOnRunFailed);
  const setNotifyOnRunFailed = useUserPreferencesStore((s) => s.setNotifyOnRunFailed);
  const notifyOnScheduleTriggered = useUserPreferencesStore((s) => s.notifyOnScheduleTriggered);
  const setNotifyOnScheduleTriggered = useUserPreferencesStore(
    (s) => s.setNotifyOnScheduleTriggered,
  );

  const options: NotificationOption[] = [
    {
      id: 'run-complete',
      label: 'Run completed',
      description: 'Get notified when a workflow run completes successfully.',
      checked: notifyOnRunComplete,
      onChange: setNotifyOnRunComplete,
    },
    {
      id: 'run-failed',
      label: 'Run failed',
      description: 'Get notified when a workflow run fails or encounters an error.',
      checked: notifyOnRunFailed,
      onChange: setNotifyOnRunFailed,
    },
    {
      id: 'schedule-triggered',
      label: 'Schedule triggered',
      description: 'Get notified when a scheduled workflow is automatically triggered.',
      checked: notifyOnScheduleTriggered,
      onChange: setNotifyOnScheduleTriggered,
    },
  ];

  return (
    <div className="space-y-8 max-w-2xl">
      <div className="space-y-3">
        <div>
          <Label className="text-sm font-medium">Notification preferences</Label>
          <p className="text-xs text-muted-foreground mt-1">
            Choose which events trigger in-app notifications.
          </p>
        </div>
        <div className="space-y-4">
          {options.map((option) => (
            <div
              key={option.id}
              className="flex items-center justify-between rounded-lg border border-border p-4"
            >
              <div className="space-y-0.5 pr-4">
                <Label htmlFor={option.id} className="text-sm font-medium cursor-pointer">
                  {option.label}
                </Label>
                <p className="text-xs text-muted-foreground">{option.description}</p>
              </div>
              <Switch id={option.id} checked={option.checked} onCheckedChange={option.onChange} />
            </div>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Notification preferences are stored locally and apply to this browser only.
      </p>
    </div>
  );
}
