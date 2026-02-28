import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import { Settings } from 'lucide-react';

import { useAuthStore } from '@/store/authStore';
import { hasAdminRole } from '@/utils/auth';
import { AuditLogSettings } from '@/pages/settings/AuditLogSettings';
import { GeneralSettings } from '@/pages/settings/GeneralSettings';
import { AppearanceSettings } from '@/pages/settings/AppearanceSettings';
import { cn } from '@/lib/utils';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

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
      label: 'Audit',
      to: '/settings/audit',
      adminOnly: true,
    },
  ];

  const visibleTabs = tabs.filter((t) => (t.adminOnly ? isAdmin : true));

  return (
    <div className="flex-1 bg-background">
      <div className="container mx-auto py-4 md:py-8 px-3 md:px-4">
        {visibleTabs.length > 0 ? (
          <div className="flex flex-col gap-4">
            <div className="flex gap-2 border-b overflow-x-auto">
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
            </div>

            <Routes>
              <Route path="/" element={<Navigate to="general" replace />} />
              <Route path="general" element={<GeneralSettings />} />
              <Route path="appearance" element={<AppearanceSettings />} />
              {isAdmin && <Route path="audit" element={<AuditLogSettings />} />}
            </Routes>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Settings className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <h2 className="text-lg font-medium text-foreground mb-2">Coming Soon</h2>
            <p className="text-sm text-muted-foreground max-w-md">
              Additional settings will appear here as features are enabled.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
