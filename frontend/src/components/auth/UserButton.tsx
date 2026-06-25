import React, { useState } from 'react';
import { useAuthProvider } from '../../auth/auth-context';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { PopoverAnchor } from '../ui/popover';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Bell, Shield, User, LogOut, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import {
  NotificationCountBadge,
  NotificationsPopover,
} from '@/components/layout/NotificationCenter';
import { selectUnreadCount, useNotificationStore } from '@/store/notificationStore';

/** Structural type for Clerk-compatible appearance prop. */
interface ClerkAppearanceConfig {
  elements?: Record<string, string>;
  [key: string]: unknown;
}

interface UserButtonProps {
  afterSignOutUrl?: string;
  appearance?: ClerkAppearanceConfig;
  showUserInfo?: boolean;
  className?: string;
  sidebarCollapsed?: boolean;
  /** Smaller sizing for the sidebar footer. */
  compact?: boolean;
  /** Badge on avatar opens notifications; avatar opens the user menu. */
  integratedNotifications?: boolean;
}

export const UserButton: React.FC<UserButtonProps> = ({
  afterSignOutUrl = '/',
  appearance,
  showUserInfo = true,
  className = '',
  sidebarCollapsed = false,
  compact = false,
  integratedNotifications = false,
}) => {
  const authProvider = useAuthProvider();
  const { user, isAuthenticated, isLoading } = authProvider.context;
  const navigate = useNavigate();
  const unreadCount = useNotificationStore(selectUnreadCount);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const openNotifications = () => {
    setUserMenuOpen(false);
    setNotificationsOpen(true);
  };

  // Handle loading state
  if (isLoading) {
    return (
      <Button variant="ghost" size="sm" disabled className={className}>
        <div className="animate-pulse flex items-center space-x-2">
          <div className="w-7 h-7 bg-muted rounded-full"></div>
          <div className="w-16 h-4 bg-muted rounded"></div>
        </div>
      </Button>
    );
  }

  // If not authenticated, show sign in button
  if (!isAuthenticated || !user) {
    return (
      <Button variant="outline" size="sm" onClick={authProvider.signIn} className={className}>
        <User className="w-4 h-4 mr-2" />
        Sign In
      </Button>
    );
  }

  // Use Clerk's UserButton if available
  if (authProvider.name === 'clerk') {
    const ClerkUserButton = authProvider.UserButtonComponent;
    const avatarSize = compact ? 'w-7 h-7' : 'w-8 h-8';

    if (integratedNotifications) {
      return (
        <NotificationsPopover
          open={notificationsOpen}
          onOpenChange={setNotificationsOpen}
          side="top"
        >
          <PopoverAnchor asChild>
            <div
              className={cn(
                'relative flex items-center',
                sidebarCollapsed ? 'mx-auto' : 'min-w-0 flex-1',
                className,
              )}
            >
              <div className="relative shrink-0">
                <ClerkUserButton
                  afterSignOutUrl={afterSignOutUrl}
                  appearance={{
                    elements: {
                      avatarBox: avatarSize,
                      userButtonTrigger: avatarSize,
                      ...appearance?.elements,
                    },
                    ...appearance,
                  }}
                />
                {unreadCount > 0 && (
                  <NotificationCountBadge
                    compact={compact}
                    count={unreadCount}
                    onClick={openNotifications}
                  />
                )}
              </div>
            </div>
          </PopoverAnchor>
        </NotificationsPopover>
      );
    }

    return (
      <div className={cn('flex items-center', className)}>
        <ClerkUserButton
          afterSignOutUrl={afterSignOutUrl}
          appearance={{
            elements: {
              avatarBox: avatarSize,
              userButtonTrigger: sidebarCollapsed ? avatarSize : 'w-full',
              ...appearance?.elements,
            },
            ...appearance,
          }}
        />
      </div>
    );
  }

  // Fallback custom user button for other providers
  const userInitials =
    user.firstName && user.lastName
      ? `${user.firstName[0]}${user.lastName[0]}`
      : user.username
        ? user.username.substring(0, 2).toUpperCase()
        : user.email
          ? user.email.substring(0, 2).toUpperCase()
          : 'U';

  const displayName =
    user.firstName && user.lastName
      ? `${user.firstName} ${user.lastName}`
      : user.username || user.email?.split('@')[0] || 'User';

  const avatarNode = (
    <div className="relative shrink-0">
      <Avatar className={cn('flex-shrink-0', compact ? 'h-7 w-7' : 'h-8 w-8')}>
        <AvatarImage src={user.imageUrl} alt={user.username || user.email} />
        <AvatarFallback>{userInitials}</AvatarFallback>
      </Avatar>
      {integratedNotifications && unreadCount > 0 && (
        <NotificationCountBadge compact={compact} count={unreadCount} onClick={openNotifications} />
      )}
    </div>
  );

  const userMenuItems = (
    <>
      {showUserInfo && (
        <>
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium leading-none">
                {user.firstName && user.lastName
                  ? `${user.firstName} ${user.lastName}`
                  : user.username || 'User'}
              </p>
              <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
              {user.organizationName && (
                <p className="text-xs leading-none text-muted-foreground">
                  {user.organizationName}
                  {user.organizationRole && <span className="ml-1">• {user.organizationRole}</span>}
                </p>
              )}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
        </>
      )}

      {integratedNotifications && (
        <DropdownMenuItem
          onSelect={() => {
            openNotifications();
          }}
        >
          <Bell className="mr-2 h-4 w-4" />
          <span>Notifications{unreadCount > 0 ? ` (${unreadCount})` : ''}</span>
        </DropdownMenuItem>
      )}

      <DropdownMenuItem>
        <User className="mr-2 h-4 w-4" />
        <span>Profile</span>
      </DropdownMenuItem>

      <DropdownMenuItem onClick={() => navigate('/settings/audit')}>
        <Settings className="mr-2 h-4 w-4" />
        <span>Settings</span>
      </DropdownMenuItem>

      {user.organizationId && (
        <DropdownMenuItem>
          <Shield className="mr-2 h-4 w-4" />
          <span>Organization</span>
        </DropdownMenuItem>
      )}

      <DropdownMenuSeparator />

      <DropdownMenuItem onClick={() => authProvider.signOut()} className="text-red-600">
        <LogOut className="mr-2 h-4 w-4" />
        <span>Sign out</span>
      </DropdownMenuItem>

      <DropdownMenuSeparator />

      <div className="px-2 py-1.5 text-xs text-muted-foreground">Provider: {authProvider.name}</div>
    </>
  );

  const userMenuTrigger = (
    <Button
      variant="ghost"
      className={cn(
        'relative flex items-center justify-start w-full',
        compact ? 'gap-1.5 p-0.5 h-auto' : 'gap-3 p-2 h-auto',
        sidebarCollapsed ? 'justify-center w-auto' : '',
        className,
      )}
    >
      {avatarNode}
      {!sidebarCollapsed && (
        <div className="flex flex-col items-start min-w-0 flex-1">
          <span
            className={cn(
              'font-medium truncate w-full transition-all duration-300',
              compact ? 'text-[11px]' : 'text-sm',
              sidebarCollapsed ? 'opacity-0 max-w-0' : 'opacity-100 max-w-full',
            )}
          >
            {displayName}
          </span>
          {user.email && !compact && (
            <span
              className={cn(
                'text-xs text-muted-foreground truncate w-full transition-all duration-300',
                sidebarCollapsed ? 'opacity-0 max-w-0' : 'opacity-100 max-w-full',
              )}
            >
              {user.email}
            </span>
          )}
        </div>
      )}
    </Button>
  );

  if (integratedNotifications) {
    return (
      <NotificationsPopover open={notificationsOpen} onOpenChange={setNotificationsOpen} side="top">
        <DropdownMenu
          open={userMenuOpen}
          onOpenChange={(open) => {
            setUserMenuOpen(open);
            if (open) {
              setNotificationsOpen(false);
            }
          }}
        >
          <DropdownMenuTrigger asChild>
            <PopoverAnchor asChild>{userMenuTrigger}</PopoverAnchor>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end" forceMount>
            {userMenuItems}
          </DropdownMenuContent>
        </DropdownMenu>
      </NotificationsPopover>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{userMenuTrigger}</DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        {userMenuItems}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

// Compact version for navigation bars
export const UserButtonCompact: React.FC<Omit<UserButtonProps, 'showUserInfo'>> = (props) => {
  return <UserButton {...props} showUserInfo={false} />;
};

// Text-based version for mobile or accessibility
export const UserButtonText: React.FC<{ className?: string }> = ({ className = '' }) => {
  const authProvider = useAuthProvider();
  const { user, isAuthenticated, isLoading } = authProvider.context;

  if (isLoading) {
    return <div className={cn('animate-pulse w-16 h-4 bg-muted rounded', className)}></div>;
  }

  if (!isAuthenticated || !user) {
    return (
      <Button variant="ghost" size="sm" onClick={authProvider.signIn} className={className}>
        Sign In
      </Button>
    );
  }

  return (
    <Button variant="ghost" size="sm" onClick={() => authProvider.signOut()} className={className}>
      Sign Out
    </Button>
  );
};
