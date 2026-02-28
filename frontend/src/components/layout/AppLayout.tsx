import { ThemeTransition } from '@/components/ui/ThemeTransition';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarItem,
} from '@/components/ui/sidebar';
import { AppTopBar } from '@/components/layout/AppTopBar';
import { Button } from '@/components/ui/button';
import {
  Workflow,
  KeyRound,
  Plus,
  Plug,
  Archive,
  CalendarClock,
  Sun,
  Moon,
  Shield,
  Search,
  Command,
  Zap,
  Webhook,
  ServerCog,
  BarChart3,
  Settings,
  ChevronDown,
  Package,
  X,
} from 'lucide-react';
import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/store/authStore';
import { hasAdminRole } from '@/utils/auth';
import { UserButton } from '@/components/auth/UserButton';
import { useAuth, useAuthProvider } from '@/auth/auth-context';
import { env } from '@/config/env';
import { useThemeStore } from '@/store/themeStore';
import { cn } from '@/lib/utils';
import { useCommandPaletteStore } from '@/store/commandPaletteStore';
import { useUserPreferencesStore } from '@/store/userPreferencesStore';
import { usePrefetchOnIdle } from '@/hooks/usePrefetchOnIdle';
import { prefetchIdleRoutes, prefetchRoute } from '@/lib/prefetch-routes';

interface AppLayoutProps {
  children: React.ReactNode;
}

import { SidebarContext, type SidebarContextValue } from './sidebar-context';
import { useIsMobile, useIsTablet } from '@/hooks/useIsMobile';
import { useIsMac } from '@/hooks/useIsMac';

const settingsItems = [
  {
    name: 'Secrets',
    href: '/secrets',
    icon: KeyRound,
  },
  {
    name: 'API Keys',
    href: '/api-keys',
    icon: Shield,
  },
  {
    name: 'MCP Servers',
    href: '/mcp-library',
    icon: ServerCog,
  },
  ...(env.VITE_OPENSEARCH_DASHBOARDS_URL
    ? [
        {
          name: 'Analytics Settings',
          href: '/analytics-settings',
          icon: Settings,
        },
      ]
    : []),
];

export function AppLayout({ children }: AppLayoutProps) {
  usePrefetchOnIdle();

  // Prefetch all route chunks during idle time
  useEffect(() => {
    prefetchIdleRoutes();
  }, []);
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const isMac = useIsMac();
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile && !isTablet);
  const [wasExplicitlyOpened, setWasExplicitlyOpened] = useState(!isMobile && !isTablet);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const roles = useAuthStore((state) => state.roles);
  const canManageWorkflows = hasAdminRole(roles);
  const { isAuthenticated } = useAuth();
  const authProvider = useAuthProvider();
  const showUserButton = isAuthenticated || authProvider.name === 'clerk';
  const { theme, startTransition } = useThemeStore();
  const openCommandPalette = useCommandPaletteStore((state) => state.open);
  const sidebarDensity = useUserPreferencesStore((s) => s.sidebarDensity);
  const isCompact = sidebarDensity === 'compact';

  // Get git SHA for version display (monorepo - same for frontend and backend)
  const gitSha = env.VITE_GIT_SHA;
  // If it's a tag (starts with v), show full tag. Otherwise show first 7 chars of SHA
  const displayVersion =
    gitSha && gitSha !== '' && gitSha !== 'unknown'
      ? gitSha.startsWith('v')
        ? gitSha
        : gitSha.slice(0, 7)
      : 'dev';

  // Auto-collapse sidebar when opening workflow builder, expand for other routes
  // On mobile, always start collapsed; on tablet, keep collapsed (icon-only)
  useEffect(() => {
    if (isMobile || isTablet) {
      setSidebarOpen(false);
      setWasExplicitlyOpened(false);
    } else {
      const isWorkflowRoute =
        (location.pathname.startsWith('/workflows') ||
          location.pathname.startsWith('/webhooks/')) &&
        location.pathname !== '/';
      setSidebarOpen(!isWorkflowRoute);
      setWasExplicitlyOpened(!isWorkflowRoute);
    }
  }, [location.pathname, isMobile, isTablet]);

  // Auto-expand the Manage section when navigating to a settings sub-page
  // (includes both settingsItems routes like /secrets, /api-keys, /mcp-library
  // and the Settings page at /settings/*)
  useEffect(() => {
    const isSettingsPage =
      settingsItems.some(
        (item) => location.pathname === item.href || location.pathname.startsWith(item.href + '/'),
      ) || location.pathname.startsWith('/settings');
    if (isSettingsPage && !settingsOpen) {
      setSettingsOpen(true);
    }
  }, [location.pathname, settingsOpen]);

  // Handle hover to expand sidebar when collapsed (desktop only)
  const handleMouseEnter = () => {
    if (isMobile) return;
    if (!sidebarOpen) {
      setSidebarOpen(true);
    }
  };

  const handleMouseLeave = () => {
    if (isMobile) return;
    // Only collapse if it was expanded due to hover (not explicitly opened)
    if (!wasExplicitlyOpened && sidebarOpen) {
      setSidebarOpen(false);
    }
  };

  // Close sidebar when window loses focus (e.g., CMD+click opens new tab)
  useEffect(() => {
    const handleWindowBlur = () => {
      // Only collapse if it was expanded due to hover (not explicitly opened)
      if (!isMobile && !wasExplicitlyOpened && sidebarOpen) {
        setSidebarOpen(false);
      }
    };

    const handleVisibilityChange = () => {
      // When tab becomes hidden (e.g., user switched tabs), collapse hover-opened sidebar
      if (document.hidden && !isMobile && !wasExplicitlyOpened && sidebarOpen) {
        setSidebarOpen(false);
      }
    };

    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isMobile, wasExplicitlyOpened, sidebarOpen]);

  const handleToggle = useCallback(() => {
    const newState = !sidebarOpen;
    setSidebarOpen(newState);
    setWasExplicitlyOpened(newState);
  }, [sidebarOpen]);

  // --- Swipe Gesture Logic for Mobile ---
  const [touchStart, setTouchStart] = useState<number | null>(null);

  useEffect(() => {
    if (!isMobile) return;

    const handleTouchStart = (e: TouchEvent) => {
      const x = e.touches[0].clientX;
      // Start tracking if touching near the left edge to open
      if (!sidebarOpen && x < 30) {
        setTouchStart(x);
      }
      // Or if sidebar is already open, track anywhere to detect closing swipe
      else if (sidebarOpen) {
        setTouchStart(x);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (touchStart === null) return;

      const currentX = e.touches[0].clientX;
      const diff = currentX - touchStart;

      // Prevent default scrolling if we are clearly swiping the sidebar
      if (Math.abs(diff) > 10) {
        // If sidebar is closed and we're swiping right (opening)
        if (!sidebarOpen && diff > 0) {
          // e.preventDefault() // This might trigger passive warning if not careful
        }
        // If sidebar is open and we're swiping left (closing)
        if (sidebarOpen && diff < 0) {
          // e.preventDefault()
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (touchStart === null) return;

      const endX = e.changedTouches[0].clientX;
      const diff = endX - touchStart;
      const threshold = 50; // px to trigger toggle

      // Swipe right to open
      if (!sidebarOpen && diff > threshold && touchStart < 30) {
        setSidebarOpen(true);
        setWasExplicitlyOpened(true);
      }
      // Swipe left to close
      else if (sidebarOpen && diff < -threshold) {
        setSidebarOpen(false);
        setWasExplicitlyOpened(false);
      }

      setTouchStart(null);
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isMobile, sidebarOpen, touchStart]);

  // Close sidebar when clicking backdrop on mobile
  const handleBackdropClick = useCallback(() => {
    if (isMobile && sidebarOpen) {
      setSidebarOpen(false);
      setWasExplicitlyOpened(false);
    }
  }, [isMobile, sidebarOpen]);

  const sidebarContextValue: SidebarContextValue = {
    isOpen: sidebarOpen,
    isMobile,
    toggle: handleToggle,
  };

  const navigationItems = [
    {
      name: 'Workflow Builder',
      href: '/',
      icon: Workflow,
    },
    {
      name: 'Template Library',
      href: '/templates',
      icon: Package,
    },
    {
      name: 'Schedules',
      href: '/schedules',
      icon: CalendarClock,
    },
    {
      name: 'Webhooks',
      href: '/webhooks',
      icon: Webhook,
    },
    {
      name: 'Action Center',
      href: '/action-center',
      icon: Zap,
    },
    ...(env.VITE_ENABLE_CONNECTIONS
      ? [
          {
            name: 'Connections',
            href: '/integrations',
            icon: Plug,
          },
        ]
      : []),
    {
      name: 'Artifact Library',
      href: '/artifacts',
      icon: Archive,
    },
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

  const isActive = (path: string) => {
    // Settings pages have no corresponding sidebar item — nothing should highlight
    if (location.pathname.startsWith('/settings')) {
      return false;
    }
    if (path === '/') {
      return location.pathname === '/' || location.pathname.startsWith('/workflows');
    }
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  // Get page-specific actions
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

        {/* Sidebar */}
        <Sidebar
          className={cn(
            'h-full transition-all duration-300 z-[110]',
            // Mobile: Fixed position, slide in/out
            isMobile ? 'fixed left-0 top-0' : 'relative',
            // Width based on state and device
            sidebarOpen ? 'w-72' : isMobile ? 'w-0 -translate-x-full' : 'w-16',
            // Ensure sidebar is above backdrop on mobile
            isMobile && sidebarOpen && 'translate-x-0',
            // Prevent closed mobile sidebar from blocking clicks
            !sidebarOpen && isMobile && 'pointer-events-none',
            sidebarOpen && isMobile && 'pointer-events-auto',
          )}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {/* Sidebar Header - same style for mobile and desktop */}
          <SidebarHeader className="flex items-center justify-between p-4 border-b">
            <Link
              to="/"
              className="flex items-center gap-2 min-w-0 flex-1"
              onClick={() => isMobile && setSidebarOpen(false)}
            >
              <div className="flex-shrink-0">
                <img
                  src="/favicon.ico"
                  alt="ShipSec Studio"
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
                ShipSec Studio
              </span>
            </Link>
            {isMobile && sidebarOpen && (
              <button
                onClick={() => {
                  setSidebarOpen(false);
                  setWasExplicitlyOpened(false);
                }}
                className="p-2.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 min-h-11 min-w-11 flex items-center justify-center"
                aria-label="Close sidebar"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </SidebarHeader>

          <SidebarContent className="py-0">
            <nav aria-label="Main navigation">
              <ul className={cn('list-none px-2 mt-2', isCompact ? 'space-y-0.5' : 'space-y-1')}>
                {navigationItems.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.href);
                  const isExternal = 'external' in item && item.external;
                  const openInNewTab =
                    isExternal && 'newTab' in item ? item.newTab !== false : true;

                  // Render external link
                  if (isExternal) {
                    return (
                      <li key={item.href}>
                        <a
                          href={item.href}
                          target={openInNewTab ? '_blank' : undefined}
                          rel={openInNewTab ? 'noopener noreferrer' : undefined}
                          onClick={() => {
                            // Close sidebar on mobile after clicking
                            if (isMobile) {
                              setSidebarOpen(false);
                            }
                          }}
                        >
                          <SidebarItem
                            isActive={false}
                            className={cn(
                              'flex items-center',
                              isCompact ? 'gap-2 py-1.5 md:py-1 min-h-[36px] md:min-h-0' : 'gap-3',
                              sidebarOpen ? 'justify-start px-4' : 'justify-center',
                            )}
                          >
                            <Icon
                              className={cn('flex-shrink-0', isCompact ? 'h-4 w-4' : 'h-5 w-5')}
                            />
                            <span
                              className={cn(
                                'transition-all duration-300 whitespace-nowrap overflow-hidden flex-1',
                                isCompact && 'text-xs',
                                sidebarOpen ? 'opacity-100' : 'opacity-0 max-w-0',
                              )}
                              style={{
                                transitionDelay: sidebarOpen ? '200ms' : '0ms',
                                transitionProperty: 'opacity, max-width',
                              }}
                            >
                              {item.name}
                            </span>
                          </SidebarItem>
                        </a>
                      </li>
                    );
                  }

                  // Render internal link (React Router)
                  return (
                    <li key={item.href}>
                      <Link
                        to={item.href}
                        onMouseEnter={() => prefetchRoute(item.href)}
                        onClick={(e) => {
                          // If modifier key is held (CMD+click, Ctrl+click), link opens in new tab
                          // Don't update sidebar state in this case
                          if (e.metaKey || e.ctrlKey || e.shiftKey) {
                            return;
                          }
                          // Close sidebar on mobile after navigation
                          if (isMobile) {
                            setSidebarOpen(false);
                            return;
                          }
                          // Keep sidebar open when navigating to non-workflow routes (desktop)
                          if (!item.href.startsWith('/workflows')) {
                            setSidebarOpen(true);
                            setWasExplicitlyOpened(true);
                          }
                        }}
                      >
                        <SidebarItem
                          isActive={active}
                          className={cn(
                            'flex items-center',
                            isCompact ? 'gap-2 py-1.5 md:py-1 min-h-[36px] md:min-h-0' : 'gap-3',
                            sidebarOpen ? 'justify-start px-4' : 'justify-center',
                          )}
                        >
                          <Icon
                            className={cn('flex-shrink-0', isCompact ? 'h-4 w-4' : 'h-5 w-5')}
                          />
                          <span
                            className={cn(
                              'transition-all duration-300 whitespace-nowrap overflow-hidden flex-1',
                              isCompact && 'text-xs',
                              sidebarOpen ? 'opacity-100' : 'opacity-0 max-w-0',
                            )}
                            style={{
                              transitionDelay: sidebarOpen ? '200ms' : '0ms',
                              transitionProperty: 'opacity, max-width',
                            }}
                          >
                            {item.name}
                          </span>
                        </SidebarItem>
                      </Link>
                    </li>
                  );
                })}
              </ul>

              {/* Manage Collapsible Section */}
              <div className="px-2 mt-2">
                <button
                  onClick={() => setSettingsOpen(!settingsOpen)}
                  aria-expanded={settingsOpen}
                  aria-controls="manage-nav-section"
                  className={cn(
                    'w-full flex items-center rounded-lg transition-colors',
                    isCompact ? 'gap-2 py-1.5' : 'gap-3 py-2',
                    'hover:bg-muted/50 text-muted-foreground hover:text-foreground',
                    sidebarOpen ? 'justify-between px-4' : 'justify-center',
                  )}
                >
                  <div className={cn('flex items-center', isCompact ? 'gap-2' : 'gap-3')}>
                    <Settings className={cn('flex-shrink-0', isCompact ? 'h-4 w-4' : 'h-5 w-5')} />
                    <span
                      className={cn(
                        'transition-all duration-300 whitespace-nowrap overflow-hidden font-medium',
                        isCompact ? 'text-xs' : 'text-sm',
                        sidebarOpen ? 'opacity-100' : 'opacity-0 max-w-0',
                      )}
                      style={{
                        transitionDelay: sidebarOpen ? '200ms' : '0ms',
                        transitionProperty: 'opacity, max-width',
                      }}
                    >
                      Manage
                    </span>
                  </div>
                  {sidebarOpen && (
                    <ChevronDown
                      className={cn(
                        'h-4 w-4 transition-transform duration-200 flex-shrink-0',
                        settingsOpen ? 'rotate-180' : '',
                      )}
                    />
                  )}
                </button>

                {/* Collapsible Manage Items */}
                <ul
                  id="manage-nav-section"
                  className={cn(
                    'list-none overflow-hidden transition-[max-height] duration-300',
                    settingsOpen && sidebarOpen ? 'max-h-96 mt-1 space-y-0.5' : 'max-h-0',
                  )}
                >
                  {settingsItems.map((item) => {
                    const Icon = item.icon;
                    const active = isActive(item.href);
                    return (
                      <li key={item.href}>
                        <Link
                          to={item.href}
                          onMouseEnter={() => prefetchRoute(item.href)}
                          onClick={(e) => {
                            if (e.metaKey || e.ctrlKey || e.shiftKey) {
                              return;
                            }
                            if (isMobile) {
                              setSidebarOpen(false);
                              return;
                            }
                            if (!item.href.startsWith('/workflows')) {
                              setSidebarOpen(true);
                              setWasExplicitlyOpened(true);
                            }
                          }}
                        >
                          <SidebarItem
                            isActive={active}
                            className={cn(
                              'flex items-center',
                              isCompact ? 'gap-2 py-1.5 md:py-1 min-h-[36px] md:min-h-0' : 'gap-3',
                              sidebarOpen ? 'justify-start px-4' : 'justify-center',
                            )}
                          >
                            <Icon
                              className={cn('flex-shrink-0', isCompact ? 'h-3.5 w-3.5' : 'h-4 w-4')}
                            />
                            <span
                              className={cn(
                                'transition-all duration-300 whitespace-nowrap overflow-hidden flex-1',
                                isCompact ? 'text-xs' : 'text-sm',
                                sidebarOpen ? 'opacity-100' : 'opacity-0 max-w-0',
                              )}
                              style={{
                                transitionDelay: sidebarOpen ? '200ms' : '0ms',
                                transitionProperty: 'opacity, max-width',
                              }}
                            >
                              {item.name}
                            </span>
                          </SidebarItem>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </nav>

            {/* Command Palette Button */}
            <div className="px-2 mt-4 pt-4 border-t border-border/40">
              <button
                onClick={openCommandPalette}
                className={cn(
                  'w-full flex items-center gap-3 py-2.5 rounded-lg transition-colors',
                  'bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground',
                  sidebarOpen ? 'justify-between px-4' : 'justify-center',
                )}
              >
                <div className="flex items-center gap-3">
                  <Search className="h-4 w-4 flex-shrink-0" />
                  <span
                    className={cn(
                      'transition-all duration-300 whitespace-nowrap overflow-hidden text-sm',
                      sidebarOpen ? 'opacity-100' : 'opacity-0 max-w-0',
                    )}
                    style={{
                      transitionDelay: sidebarOpen ? '200ms' : '0ms',
                      transitionProperty: 'opacity, max-width',
                    }}
                  >
                    Search...
                  </span>
                </div>
                {sidebarOpen && (
                  <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded border border-border/60 bg-background/80 px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                    {isMac ? (
                      <>
                        <Command className="h-2.5 w-2.5" />K
                      </>
                    ) : (
                      'Ctrl+K'
                    )}
                  </kbd>
                )}
              </button>
            </div>
          </SidebarContent>

          <SidebarFooter className="border-t p-0">
            <div className="flex flex-col gap-1.5 p-1">
              {/* Auth components - UserButton includes organization switching */}
              {showUserButton && (
                <div
                  className={cn(
                    'flex items-center gap-2',
                    sidebarOpen ? 'justify-between' : 'justify-center',
                  )}
                >
                  <UserButton
                    className={sidebarOpen ? 'flex-1' : 'w-auto'}
                    sidebarCollapsed={!sidebarOpen}
                  />
                  {/* Dark mode toggle */}
                  {sidebarOpen && (
                    <button
                      onClick={startTransition}
                      className="p-2.5 rounded-lg transition-colors hover:bg-accent hover:text-accent-foreground text-muted-foreground flex-shrink-0 min-h-11 min-w-11 flex items-center justify-center"
                      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                    >
                      {theme === 'dark' ? (
                        <Sun className="h-5 w-5 text-amber-500" />
                      ) : (
                        <Moon className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                      )}
                    </button>
                  )}
                </div>
              )}
              {/* Dark mode toggle when no user button */}
              {!showUserButton && (
                <div className={cn('flex', sidebarOpen ? 'justify-end' : 'justify-center')}>
                  <button
                    onClick={startTransition}
                    className="p-2.5 rounded-lg transition-colors hover:bg-accent hover:text-accent-foreground text-muted-foreground min-h-11 min-w-11 flex items-center justify-center"
                    aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                  >
                    {theme === 'dark' ? (
                      <Sun className="h-5 w-5 text-amber-500" />
                    ) : (
                      <Moon className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                    )}
                  </button>
                </div>
              )}
            </div>
          </SidebarFooter>

          {/* Version info - its own dedicated section at absolute bottom with animation */}
          <div className="px-2 py-1.5 border-t">
            <div className="h-4 flex items-center justify-center">
              <span
                className={cn(
                  'text-xs text-muted-foreground transition-all duration-300 whitespace-nowrap overflow-hidden block text-center',
                  sidebarOpen ? 'opacity-100 max-w-full' : 'opacity-0 max-w-0',
                )}
                style={{
                  transitionDelay: sidebarOpen ? '200ms' : '0ms',
                  transitionProperty: 'opacity, max-width',
                }}
              >
                version: {displayVersion}
              </span>
            </div>
          </div>
        </Sidebar>

        {/* Main content area */}
        <main
          id="main-content"
          tabIndex={-1}
          className={cn(
            'flex-1 flex flex-col overflow-hidden min-w-0 outline-none',
            // On mobile, main content takes full width since sidebar is overlay
            isMobile ? 'w-full' : '',
          )}
        >
          {/* Only show AppTopBar for non-workflow-builder and non-webhook-editor pages */}
          {!location.pathname.startsWith('/workflows') &&
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
