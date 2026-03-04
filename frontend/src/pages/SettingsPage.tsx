import { NavLink, Route, Routes, Navigate } from 'react-router-dom';

import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuthStore } from '@/store/authStore';
import { hasAdminRole } from '@/utils/auth';
import { AuditLogSettings } from '@/pages/settings/AuditLogSettings';
import { GeneralSettings } from '@/pages/settings/GeneralSettings';
import { AppearanceSettings } from '@/pages/settings/AppearanceSettings';
import { NotificationSettings } from '@/pages/settings/NotificationSettings';
import { KeyboardShortcutsSettings } from '@/pages/settings/KeyboardShortcutsSettings';
import { ChannelSettings } from '@/pages/settings/ChannelSettings';
import { TicketingSettings } from '@/pages/settings/TicketingSettings';
import { cn } from '@/lib/utils';

export function SettingsPage() {
  useDocumentTitle('Settings');
  const roles = useAuthStore((state) => state.roles);
  const isAdmin = hasAdminRole(roles);

  const tabs = [
    {
      label: 'General',
      to: '/settings/general',
      adminOnly: false,
    },
    {
      label: 'Appearance',
      to: '/settings/appearance',
      adminOnly: false,
    },
    {
      label: 'Notifications',
      to: '/settings/notifications',
      adminOnly: false,
    },
    {
      label: 'Shortcuts',
      to: '/settings/shortcuts',
      adminOnly: false,
    },
    {
      label: 'Channels',
      to: '/settings/channels',
      adminOnly: true,
    },
    {
      label: 'Ticketing',
      to: '/settings/ticketing',
      adminOnly: true,
    },
    {
      label: 'Audit',
      to: '/settings/audit',
      adminOnly: true,
    },
  ];

  const visibleTabs = tabs.filter((t) => (t.adminOnly ? isAdmin : true));

  return (
    <div className="flex-1 bg-background">
      <div className="container mx-auto py-4 md:py-8 px-3 md:px-4">
        <div className="flex flex-col gap-4">
          <nav
            role="navigation"
            aria-label="Settings"
            className="flex gap-2 border-b overflow-x-auto scrollbar-hide"
          >
            {visibleTabs.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                className={({ isActive }) =>
                  cn(
                    'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
                    isActive
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {tab.label}
              </NavLink>
            ))}
          </nav>

          <Routes>
            <Route path="/" element={<Navigate to="general" replace />} />
            <Route path="general" element={<GeneralSettings />} />
            <Route path="appearance" element={<AppearanceSettings />} />
            <Route path="notifications" element={<NotificationSettings />} />
            <Route path="shortcuts" element={<KeyboardShortcutsSettings />} />
            {isAdmin && <Route path="channels" element={<ChannelSettings />} />}
            {isAdmin && <Route path="ticketing" element={<TicketingSettings />} />}
            {isAdmin && <Route path="audit" element={<AuditLogSettings />} />}
            <Route path="*" element={<Navigate to="/settings/general" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
