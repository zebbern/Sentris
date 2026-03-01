import { ThemeTransition } from '@/components/ui/ThemeTransition';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar, SidebarHeader } from '@/components/ui/sidebar';
import { AppTopBar } from '@/components/layout/AppTopBar';
import { Button } from '@/components/ui/button';
import {
  Workflow,
  KeyRound,
  Plus,
  Plug,
  Archive,
  CalendarClock,
  Shield,
  Zap,
  Webhook,
  ServerCog,
  BarChart3,
  Settings,
  Package,
  X,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo } from 'react';
import { useAuthStore } from '@/store/authStore';
import { hasAdminRole } from '@/utils/auth';
import { env } from '@/config/env';
import { cn } from '@/lib/utils';
import { useCommandPaletteStore } from '@/store/commandPaletteStore';
import { useUserPreferencesStore } from '@/store/userPreferencesStore';
import { usePrefetchOnIdle } from '@/hooks/usePrefetchOnIdle';
import { prefetchIdleRoutes } from '@/lib/prefetch-routes';
import { useNotifications } from '@/hooks/useNotifications';
import { NotificationCenter } from '@/components/layout/NotificationCenter';
import { SidebarContext, type SidebarContextValue } from './sidebar-context';
import { SidebarNav, type NavItem } from './SidebarNav';
import { useSidebarState } from '@/hooks/useSidebarState';
import { useIsMobile, useIsTablet } from '@/hooks/useIsMobile';

interface AppLayoutProps {
  children: React.ReactNode;
}

const settingsItems: NavItem[] = [
  { name: 'Secrets', href: '/secrets', icon: KeyRound },
  { name: 'API Keys', href: '/api-keys', icon: Shield },
  { name: 'MCP Servers', href: '/mcp-library', icon: ServerCog },
  ...(env.VITE_OPENSEARCH_DASHBOARDS_URL
    ? [{ name: 'Analytics Settings', href: '/analytics-settings', icon: Settings }]
    : []),
  { name: 'Settings', href: '/settings', icon: Settings },
];

const SETTINGS_HREFS = settingsItems.map((item) => item.href);

const navigationItems: NavItem[] = [
  { name: 'Workflow Builder', href: '/', icon: Workflow },
  { name: 'Template Library', href: '/templates', icon: Package },
  { name: 'Schedules', href: '/schedules', icon: CalendarClock },
  { name: 'Webhooks', href: '/webhooks', icon: Webhook },
  { name: 'Action Center', href: '/action-center', icon: Zap },
  ...(env.VITE_ENABLE_CONNECTIONS
    ? [{ name: 'Connections', href: '/integrations', icon: Plug }]
    : []),
  { name: 'Artifact Library', href: '/artifacts', icon: Archive },
  ...(env.VITE_OPENSEARCH_DASHBOARDS_URL
    ? [
        {
          name: 'Dashboards',
          href: env.VITE_OPENSEARCH_DASHBOARDS_URL,
          icon: BarChart3,
          external: true,
        },
      ]
    : []),
];

export function AppLayout({ children }: AppLayoutProps) {
  usePrefetchOnIdle();
  useNotifications();

  useEffect(() => {
    prefetchIdleRoutes();
  }, []);

  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const location = useLocation();
  const navigate = useNavigate();
  const roles = useAuthStore((state) => state.roles);
  const canManageWorkflows = hasAdminRole(roles);
  const openCommandPalette = useCommandPaletteStore((state) => state.open);
  const sidebarDensity = useUserPreferencesStore((s) => s.sidebarDensity);
  const isCompact = sidebarDensity === 'compact';

  const {
    sidebarOpen,
    setSidebarOpen,
    settingsOpen,
    setSettingsOpen,
    handleToggle,
    handleMouseEnter,
    handleMouseLeave,
    handleBackdropClick,
    closeMobileSidebar,
  } = useSidebarState({ isMobile, isTablet, settingsHrefs: SETTINGS_HREFS });

  const gitSha = env.VITE_GIT_SHA;
  const displayVersion =
    gitSha && gitSha !== '' && gitSha !== 'unknown'
      ? gitSha.startsWith('v')
        ? gitSha
        : gitSha.slice(0, 7)
      : 'dev';

  const isActive = useCallback(
    (path: string) => {
      if (path === '/') {
        return location.pathname === '/' || location.pathname.startsWith('/workflows');
      }
      return location.pathname === path || location.pathname.startsWith(`${path}/`);
    },
    [location.pathname],
  );

  const handleDesktopNavClick = useCallback(
    (href: string) => {
      if (!href.startsWith('/workflows')) {
        setSidebarOpen(true);
      }
    },
    [setSidebarOpen],
  );

  const sidebarContextValue: SidebarContextValue = useMemo(
    () => ({ isOpen: sidebarOpen, isMobile, toggle: handleToggle }),
    [sidebarOpen, isMobile, handleToggle],
  );

  const getPageActions = () => {
    if (location.pathname === '/') {
      return (
        <Button
          onClick={() => {
            if (!canManageWorkflows) return;
            navigate('/workflows/new');
          }}
          size={isMobile ? 'sm' : 'default'}
          className={cn('gap-2', isMobile && 'h-8 px-3 text-xs')}
          disabled={!canManageWorkflows}
          aria-disabled={!canManageWorkflows}
        >
          <Plus className={cn('w-4 h-4', isMobile && 'w-3.5 h-3.5')} />
          <span>
            New <span className="hidden md:inline">Workflow</span>
          </span>
        </Button>
      );
    }
    return null;
  };

  return (
    <SidebarContext.Provider value={sidebarContextValue}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:z-[200] focus:top-4 focus:left-4 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:shadow-lg focus:outline-none"
      >
        Skip to main content
      </a>
      <ThemeTransition />
      <div className="flex h-screen bg-background overflow-hidden">
        {/* Mobile backdrop overlay */}
        {isMobile && sidebarOpen && (
          <div
            className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm transition-opacity duration-300"
            onClick={handleBackdropClick}
            aria-hidden="true"
          />
        )}

        <Sidebar
          className={cn(
            'h-full transition-all duration-300 z-[110]',
            isMobile ? 'fixed left-0 top-0' : 'relative',
            sidebarOpen ? 'w-72' : isMobile ? 'w-0 -translate-x-full' : 'w-16',
            isMobile && sidebarOpen && 'translate-x-0',
            !sidebarOpen && isMobile && 'pointer-events-none',
            sidebarOpen && isMobile && 'pointer-events-auto',
          )}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <SidebarHeader className="flex items-center justify-between p-4 border-b">
            <Link
              to="/"
              className="flex items-center gap-2 min-w-0 flex-1"
              onClick={() => isMobile && setSidebarOpen(false)}
            >
              <div className="flex-shrink-0">
                <img
                  src="/favicon.ico"
                  alt="Sentris Flow"
                  width={24}
                  height={24}
                  className="w-6 h-6"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    e.currentTarget.nextElementSibling?.classList.remove('hidden');
                  }}
                />
                <span className="hidden text-sm font-bold">SS</span>
              </div>
              <span
                className={cn(
                  'font-bold text-xl transition-all duration-300 whitespace-nowrap overflow-hidden',
                  sidebarOpen ? 'opacity-100 max-w-48' : 'opacity-0 max-w-0',
                )}
                style={{
                  transitionDelay: sidebarOpen ? '150ms' : '0ms',
                  transitionProperty: 'opacity, max-width',
                }}
              >
                Sentris Flow
              </span>
            </Link>
            {isMobile && sidebarOpen && (
              <button
                onClick={closeMobileSidebar}
                className="p-2.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 min-h-11 min-w-11 flex items-center justify-center"
                aria-label="Close sidebar"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </SidebarHeader>

          <SidebarNav
            sidebarOpen={sidebarOpen}
            isMobile={isMobile}
            isCompact={isCompact}
            navigationItems={navigationItems}
            settingsItems={settingsItems}
            settingsOpen={settingsOpen}
            onSettingsToggle={() => setSettingsOpen(!settingsOpen)}
            onOpenCommandPalette={openCommandPalette}
            displayVersion={displayVersion}
            isActive={isActive}
            onMobileClose={closeMobileSidebar}
            onDesktopNavClick={handleDesktopNavClick}
          />
        </Sidebar>

        <main
          id="main-content"
          tabIndex={-1}
          className={cn(
            'flex-1 flex flex-col overflow-hidden min-w-0 outline-none',
            isMobile ? 'w-full' : '',
          )}
        >
          {!location.pathname.startsWith('/workflows') &&
            !location.pathname.startsWith('/webhooks/') && (
              <AppTopBar
                sidebarOpen={sidebarOpen}
                onSidebarToggle={handleToggle}
                actions={
                  <>
                    <NotificationCenter />
                    {getPageActions()}
                  </>
                }
                isMobile={isMobile}
              />
            )}
          {location.pathname.startsWith('/webhooks/') && (
            <div className="absolute top-2 right-4 z-40">
              <NotificationCenter />
            </div>
          )}
          <div className="flex-1 overflow-auto">{children}</div>
        </main>
      </div>
    </SidebarContext.Provider>
  );
}
