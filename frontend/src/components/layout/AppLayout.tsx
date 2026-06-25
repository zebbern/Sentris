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
  Sparkles,
  Settings,
  Package,
  X,
  LayoutDashboard,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { hasAdminRole } from '@/utils/auth';
import { env } from '@/config/env';
import { cn } from '@/lib/utils';
import { useCommandPaletteStore } from '@/store/commandPaletteStore';
import { useUserPreferencesStore } from '@/store/userPreferencesStore';
import { usePrefetchOnIdle } from '@/hooks/usePrefetchOnIdle';
import { prefetchIdleRoutes } from '@/lib/prefetch-routes';
import { useNotifications } from '@/hooks/useNotifications';
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
  { name: 'Agent Skills', href: '/agent-skills', icon: Sparkles },
  ...(env.VITE_OPENSEARCH_DASHBOARDS_URL
    ? [{ name: 'Analytics Settings', href: '/analytics-settings', icon: Settings }]
    : []),
  { name: 'Settings', href: '/settings', icon: Settings },
];

const SETTINGS_HREFS = settingsItems.map((item) => item.href);

const navigationItems: NavItem[] = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Workflows', href: '/workflows', icon: Workflow },
  { name: 'Template Library', href: '/templates', icon: Package },
  { name: 'Schedules', href: '/schedules', icon: CalendarClock },
  { name: 'Webhooks', href: '/webhooks', icon: Webhook },
  { name: 'Action Center', href: '/action-center', icon: Zap },
  { name: 'Findings', href: '/findings', icon: ShieldAlert },
  { name: 'Analytics', href: '/analytics', icon: TrendingUp },
  ...(env.VITE_ENABLE_CONNECTIONS
    ? [{ name: 'Connections', href: '/integrations', icon: Plug }]
    : []),
  { name: 'Artifact Library', href: '/artifacts', icon: Archive },
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

  const [faviconError, setFaviconError] = useState(false);

  const isActive = useCallback(
    (path: string) => {
      if (path === '/') {
        return location.pathname === '/';
      }
      if (path === '/workflows') {
        return location.pathname === '/workflows' || location.pathname.startsWith('/workflows/');
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
    if (location.pathname === '/workflows') {
      return (
        <Button
          onClick={() => {
            if (!canManageWorkflows) return;
            navigate('/workflows/new');
          }}
          size="sm"
          className="gap-1.5"
          disabled={!canManageWorkflows}
          aria-disabled={!canManageWorkflows}
        >
          <Plus className="h-3.5 w-3.5" />
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
            sidebarOpen ? 'w-52' : isMobile ? 'w-0 -translate-x-full' : 'w-12',
            isMobile && sidebarOpen && 'translate-x-0',
            !sidebarOpen && isMobile && 'pointer-events-none',
            sidebarOpen && isMobile && 'pointer-events-auto',
          )}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <SidebarHeader
            className={cn(
              'flex h-10 shrink-0 items-center border-b px-2',
              sidebarOpen ? 'justify-between' : 'justify-center',
            )}
          >
            <Link
              to="/"
              className={cn(
                'flex items-center min-w-0',
                sidebarOpen ? 'gap-1.5 flex-1' : 'justify-center',
              )}
              onClick={() => isMobile && setSidebarOpen(false)}
            >
              <div className="flex-shrink-0">
                {!faviconError ? (
                  <img
                    src="/favicon.ico"
                    alt="Sentris Flow"
                    width={20}
                    height={20}
                    className="w-4 h-4"
                    onError={() => setFaviconError(true)}
                  />
                ) : (
                  <span className="text-xs font-bold">SS</span>
                )}
              </div>
              <span
                className={cn(
                  'font-bold text-sm transition-all duration-300 whitespace-nowrap overflow-hidden',
                  sidebarOpen ? 'opacity-100 max-w-32' : 'opacity-0 max-w-0',
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
                className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                aria-label="Close sidebar"
              >
                <X className="h-4 w-4" />
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
          {!location.pathname.startsWith('/workflows/') &&
            !location.pathname.startsWith('/webhooks/') && (
              <AppTopBar
                sidebarOpen={sidebarOpen}
                onSidebarToggle={handleToggle}
                actions={getPageActions()}
                isMobile={isMobile}
              />
            )}
          <div className="flex-1 overflow-auto">{children}</div>
        </main>
      </div>
    </SidebarContext.Provider>
  );
}
