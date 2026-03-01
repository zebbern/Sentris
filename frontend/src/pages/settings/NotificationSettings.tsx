import { Bell, BellOff, BellRing, CheckCircle2, Info, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useNotificationPermission } from '@/hooks/useNotificationPermission';
import { useUserPreferencesStore } from '@/store/userPreferencesStore';

interface NotificationOption {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  disabledReason?: string;
}

export function NotificationSettings() {
  useDocumentTitle('Settings · Notifications');

  const { permission, requestPermission, isSupported } = useNotificationPermission();
  const { toast } = useToast();

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

  function handleSendTestNotification() {
    let browserNotificationSent = false;
    if (permission === 'granted') {
      try {
        new Notification('Test Notification', {
          body: 'Sentris Flow notifications are working!',
          icon: '/favicon.ico',
        });
        browserNotificationSent = true;
      } catch {
        // Insecure origin or other browser restriction — fall through to toast
      }
    }
    if (!browserNotificationSent) {
      toast({
        title: 'Test Notification',
        description: 'Sentris Flow notifications are working!',
        variant: 'success',
      });
    }
  }

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Browser notification permission section */}
      <div className="space-y-3">
        <div>
          <Label className="text-sm font-medium">Browser notifications</Label>
          <p className="text-xs text-muted-foreground mt-1">
            Browser notifications appear even when this tab is in the background.
          </p>
        </div>

        <PermissionBanner
          permission={permission}
          isSupported={isSupported}
          onRequestPermission={requestPermission}
        />
      </div>

      {/* Notification preferences toggles */}
      <div className="space-y-3">
        <div>
          <Label className="text-sm font-medium">Notification preferences</Label>
          <p className="text-xs text-muted-foreground mt-1">
            Choose which events trigger notifications. Browser notifications are sent when
            permission is granted; otherwise in-app toasts are used.
          </p>
        </div>
        <div className="space-y-4">
          {options.map((option) => (
            <div
              key={option.id}
              className="flex items-center justify-between rounded-lg border border-border p-4"
            >
              <div className="space-y-0.5 pr-4">
                <div className="flex items-center gap-2">
                  <Label
                    htmlFor={option.id}
                    className={`text-sm font-medium ${option.disabled ? 'text-muted-foreground' : 'cursor-pointer'}`}
                  >
                    {option.label}
                  </Label>
                  {option.disabledReason && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {option.disabledReason}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{option.description}</p>
                {permission === 'denied' && !option.disabled && (
                  <p className="text-xs text-amber-500 mt-1">
                    Browser notifications blocked — will use in-app toasts instead.
                  </p>
                )}
              </div>
              <Switch
                id={option.id}
                checked={option.checked}
                onCheckedChange={option.onChange}
                disabled={option.disabled}
                aria-label={option.label}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Test notification */}
      <div className="space-y-3">
        <Button variant="outline" size="sm" onClick={handleSendTestNotification}>
          <BellRing className="mr-2 h-4 w-4" />
          Send test notification
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Notification preferences are stored locally and apply to this browser only.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Permission banner — renders the appropriate status for the        */
/*  current browser notification permission state.                    */
/* ------------------------------------------------------------------ */

interface PermissionBannerProps {
  permission: ReturnType<typeof useNotificationPermission>['permission'];
  isSupported: boolean;
  onRequestPermission: () => Promise<unknown>;
}

function PermissionBanner({ permission, isSupported, onRequestPermission }: PermissionBannerProps) {
  if (!isSupported) {
    return (
      <div
        className="flex items-start gap-3 rounded-lg border border-border bg-muted/50 p-4"
        role="status"
        aria-live="polite"
      >
        <BellOff className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">Not supported</p>
          <p className="text-xs text-muted-foreground">
            Browser notifications are not supported in this environment. In-app toasts will be used
            instead.
          </p>
        </div>
      </div>
    );
  }

  if (permission === 'granted') {
    return (
      <div
        className="flex items-center gap-3 rounded-lg border border-green-500/30 bg-green-500/10 p-4"
        role="status"
        aria-live="polite"
      >
        <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-green-600 dark:text-green-400">
            Browser notifications enabled
          </p>
          <Badge variant="success" className="text-[10px]">
            Granted
          </Badge>
        </div>
      </div>
    );
  }

  if (permission === 'denied') {
    return (
      <div
        className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4"
        role="alert"
        aria-live="assertive"
      >
        <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
              Browser notifications blocked
            </p>
            <Badge variant="warning" className="text-[10px]">
              Denied
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Notifications are blocked by your browser. To re-enable them, click the lock icon in
            your browser&apos;s address bar, find &quot;Notifications&quot;, and set it to
            &quot;Allow&quot;. In-app toasts will be used in the meantime.
          </p>
        </div>
      </div>
    );
  }

  // permission === 'default' — not yet requested
  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-border bg-muted/50 p-4"
      role="status"
      aria-live="polite"
    >
      <Bell className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">Browser notifications</p>
          <Badge variant="secondary" className="text-[10px]">
            Not requested
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Enable browser notifications to receive alerts even when this tab is in the background.
        </p>
        <Button size="sm" onClick={onRequestPermission}>
          <Info className="mr-2 h-4 w-4" />
          Enable browser notifications
        </Button>
      </div>
    </div>
  );
}
