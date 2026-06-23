import { Bell, Check, CheckCheck, Trash2, CircleAlert, CircleCheck } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  useNotificationStore,
  selectUnreadCount,
  type NotificationItem,
} from '@/store/notificationStore';
import { cn } from '@/lib/utils';
import { useState } from 'react';

interface NotificationCenterProps {
  className?: string;
  popoverSide?: 'top' | 'bottom' | 'left' | 'right';
}

export function NotificationCenter({
  className,
  popoverSide = 'bottom',
}: NotificationCenterProps = {}) {
  const notifications = useNotificationStore((s) => s.notifications);
  const unreadCount = useNotificationStore(selectUnreadCount);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const dismiss = useNotificationStore((s) => s.dismiss);
  const clearAll = useNotificationStore((s) => s.clearAll);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const handleNotificationClick = (notification: NotificationItem) => {
    markRead(notification.id);
    if (notification.runId) {
      navigate(`/workflows?runId=${notification.runId}`);
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('relative shrink-0', className ?? 'h-9 w-9')}
          aria-label={unreadCount > 0 ? `Notifications — ${unreadCount} unread` : 'Notifications'}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground"
              aria-hidden="true"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" side={popoverSide} sideOffset={8} className="w-80 p-0">
        {/* Panel header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold">Notifications</h3>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                onClick={markAllRead}
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all read
              </Button>
            )}
            {notifications.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                onClick={clearAll}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear
              </Button>
            )}
          </div>
        </div>

        {/* Notification list */}
        <div className="max-h-96 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <Bell className="mb-2 h-8 w-8 opacity-30" />
              <p className="text-sm">No notifications yet</p>
            </div>
          ) : (
            <ul className="list-none divide-y">
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <button
                    className={cn(
                      'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50',
                      !notification.read && 'bg-muted/30',
                    )}
                    onClick={() => handleNotificationClick(notification)}
                  >
                    {/* Variant indicator */}
                    <div className="mt-0.5 flex-shrink-0">
                      {notification.variant === 'success' ? (
                        <CircleCheck className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <CircleAlert className="h-4 w-4 text-destructive" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'truncate text-sm',
                            notification.read
                              ? 'font-normal text-muted-foreground'
                              : 'font-medium text-foreground',
                          )}
                        >
                          {notification.title}
                        </span>
                        {!notification.read && (
                          <span
                            className="h-2 w-2 flex-shrink-0 rounded-full bg-primary"
                            aria-hidden="true"
                          />
                        )}
                        {!notification.read && <span className="sr-only">(unread)</span>}
                      </div>
                      {notification.description && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {notification.description}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground/70">
                        {formatDistanceToNow(new Date(notification.timestamp), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>

                    {/* Quick actions */}
                    <div className="flex flex-shrink-0 items-center gap-1">
                      {!notification.read && (
                        <button
                          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            markRead(notification.id);
                          }}
                          aria-label="Mark as read"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          dismiss(notification.id);
                        }}
                        aria-label="Dismiss notification"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
