import { ThemeTransition } from '@/components/ui/ThemeTransition';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Sidebar, SidebarHeader } from '@/components/ui/sidebar';
import { AppTopBar } from '@/components/layout/AppTopBar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Workflow,
  KeyRound,
  Plus,
  Plug,
  Archive,
  CalendarClock,
  Target,
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
  RefreshCw,
  Search,
  LayoutList,
  Columns3,
  Bot,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { hasAdminRole } from '@/utils/auth';
import { env } from '@/config/env';
import { cn } from '@/lib/utils';
import { queryKeys } from '@/lib/queryKeys';
import { useCommandPaletteStore } from '@/store/commandPaletteStore';
import { useUserPreferencesStore } from '@/store/userPreferencesStore';
import { usePrefetchOnIdle } from '@/hooks/usePrefetchOnIdle';
import { prefetchIdleRoutes } from '@/lib/prefetch-routes';
import { useNotifications } from '@/hooks/useNotifications';
import { useOperatorNotifications } from '@/hooks/useOperatorNotifications';
import { useInvalidateHumanInputs } from '@/hooks/queries/useHumanInputQueries';
import { useToast } from '@/components/ui/use-toast';
import { OpenSearchTelemetryLink } from '@/components/analytics/OpenSearchTelemetryLink';
import {
  DEFAULT_PERIOD,
  PeriodSelector,
  VALID_PERIODS,
} from '@/features/triage-analytics/PeriodSelector';
import { SidebarContext, type SidebarContextValue } from './sidebar-context';
import { SidebarNav, type NavItem } from './SidebarNav';
import { useSidebarState } from '@/hooks/useSidebarState';
import { useIsMobile, useIsTablet } from '@/hooks/useIsMobile';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { parseLibraryTab } from '@/pages/template-library';
import { parseFindingsView } from '@/pages/findings/findingsView';
import { OperatorTopBarActions } from '@/features/operator/OperatorTopBarActions';

const TOP_BAR_CONTROL = 'h-8';
const TOP_BAR_BUTTON = 'h-8 gap-1.5';

const ACTION_CENTER_STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'expired', label: 'Expired' },
] as const;

const ACTION_CENTER_STATUSES = new Set<string>(
  ACTION_CENTER_STATUS_OPTIONS.map((option) => option.value),
);

function FindingsTopBarActions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const searchValue = searchParams.get('search') ?? '';
  const activeView = parseFindingsView(searchParams.get('view'));

  const handleSearchChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('search', value);
    else next.delete('search');
    setSearchParams(next, { replace: true });
  };

  const handleViewChange = (value: string) => {
    const view = parseFindingsView(value);
    const next = new URLSearchParams(searchParams);
    if (view === 'table') next.delete('view');
    else next.set('view', view);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={searchValue}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search findings…"
          aria-label="Search findings by name, asset, workflow"
          autoComplete="off"
          className={cn(TOP_BAR_CONTROL, 'w-36 pl-8 md:w-48')}
        />
      </div>
      <Tabs value={activeView} onValueChange={handleViewChange}>
        <TabsList aria-label="Findings view" className="h-8">
          <TabsTrigger value="table" className="h-7 gap-1 px-2 text-xs">
            <LayoutList className="h-3.5 w-3.5" />
            Table
          </TabsTrigger>
          <TabsTrigger value="kanban" className="h-7 gap-1 px-2 text-xs">
            <Columns3 className="h-3.5 w-3.5" />
            Kanban
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}

function TemplatesTopBarActions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = parseLibraryTab(searchParams.get('tab'));

  const handleTabChange = (value: string) => {
    const tab = parseLibraryTab(value);
    const next = new URLSearchParams(searchParams);
    if (tab === 'official') next.delete('tab');
    else next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <TabsList aria-label="Template library source" className="h-8">
        <TabsTrigger value="official" className="h-7 text-xs">
          Official
        </TabsTrigger>
        <TabsTrigger value="community" className="h-7 text-xs">
          Community
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

function ActionCenterTopBarActions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const invalidateHumanInputs = useInvalidateHumanInputs();
  const { toast } = useToast();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const searchValue = searchParams.get('search') ?? '';
  const rawStatus = searchParams.get('status') ?? 'pending';
  const statusFilter = ACTION_CENTER_STATUSES.has(rawStatus)
    ? (rawStatus as (typeof ACTION_CENTER_STATUS_OPTIONS)[number]['value'])
    : 'pending';

  const handleSearchChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('search', value);
    else next.delete('search');
    setSearchParams(next, { replace: true });
  };

  const handleStatusChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === 'pending') next.delete('status');
    else next.set('status', value);
    setSearchParams(next, { replace: true });
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await invalidateHumanInputs();
      toast({
        title: 'Requests refreshed',
        description: 'Latest status have been loaded.',
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={searchValue}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Filter by title, node, or run ID"
          aria-label="Search requests"
          autoComplete="off"
          className={cn(TOP_BAR_CONTROL, 'w-40 pl-8 md:w-56')}
        />
      </div>
      <Select value={statusFilter} onValueChange={handleStatusChange}>
        <SelectTrigger className={cn(TOP_BAR_CONTROL, 'w-[140px]')} aria-label="Filter by status">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          {ACTION_CENTER_STATUS_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        size="sm"
        className={TOP_BAR_BUTTON}
        onClick={handleRefresh}
        disabled={isRefreshing}
        aria-label="Refresh requests"
      >
        <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
      </Button>
    </div>
  );
}

function AnalyticsTopBarActions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawPeriod = searchParams.get('period') ?? DEFAULT_PERIOD;
  const period = VALID_PERIODS.has(rawPeriod) ? rawPeriod : DEFAULT_PERIOD;

  const handlePeriodChange = (value: string) => {
    setSearchParams({ period: value }, { replace: true });
  };

  return (
    <div className="flex items-center gap-2">
      <PeriodSelector value={period} onChange={handlePeriodChange} className={TOP_BAR_CONTROL} />
      <OpenSearchTelemetryLink className={TOP_BAR_BUTTON} />
    </div>
  );
}

function ArtifactsTopBarActions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const searchValue = searchParams.get('search') ?? '';

  const handleSearchChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('search', value);
    else next.delete('search');
    setSearchParams(next, { replace: true });
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: queryKeys.artifacts.root() });
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={searchValue}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Filter by name..."
          aria-label="Filter by name..."
          autoComplete="off"
          className={cn(TOP_BAR_CONTROL, 'w-40 pl-8 md:w-52')}
        />
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={TOP_BAR_BUTTON}
        onClick={handleRefresh}
        disabled={isRefreshing}
        aria-label="Refresh artifacts"
      >
        <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
      </Button>
    </div>
  );
}

function SchedulesTopBarActions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const searchValue = searchParams.get('search') ?? '';

  const handleSearchChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('search', value);
    else next.delete('search');
    setSearchParams(next, { replace: true });
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: queryKeys.schedules.root() });
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={searchValue}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Filter schedules..."
          aria-label="Filter by schedule or workflow"
          autoComplete="off"
          className={cn(TOP_BAR_CONTROL, 'w-40 pl-8 md:w-52')}
        />
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={TOP_BAR_BUTTON}
        onClick={handleRefresh}
        disabled={isRefreshing}
        aria-label="Refresh schedules"
      >
        <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
      </Button>
      <Button
        type="button"
        size="sm"
        className={TOP_BAR_BUTTON}
        onClick={() => {
          const next = new URLSearchParams(searchParams);
          next.set('create', '1');
          navigate(`/schedules?${next.toString()}`);
        }}
        aria-label="New schedule"
      >
        <Plus className="h-3.5 w-3.5" />
        <span>New</span>
      </Button>
    </div>
  );
}

function SecretsTopBarActions() {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: queryKeys.secrets.all() });
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={TOP_BAR_BUTTON}
      onClick={handleRefresh}
      disabled={isRefreshing}
      aria-label="Refresh secrets"
    >
      <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
    </Button>
  );
}

function ApiKeysTopBarActions() {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys.all() });
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn(TOP_BAR_CONTROL, 'w-8 px-0')}
      onClick={handleRefresh}
      disabled={isRefreshing}
      aria-label="Refresh"
    >
      <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
    </Button>
  );
}

function WebhooksTopBarActions() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: queryKeys.webhooks.all() });
      toast({
        title: 'Webhooks refreshed',
        description: 'Latest webhook configurations have been loaded.',
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={TOP_BAR_BUTTON}
        onClick={handleRefresh}
        disabled={isRefreshing}
        aria-label="Refresh webhooks"
      >
        <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
      </Button>
      <Button onClick={() => navigate('/webhooks/new')} size="sm" className={TOP_BAR_BUTTON}>
        <Plus className="h-3.5 w-3.5" />
        <span>
          New <span className="hidden md:inline">webhook</span>
        </span>
      </Button>
    </div>
  );
}

function AgentSkillsTopBarActions() {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: queryKeys.agentSkills.discovered() });
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn(TOP_BAR_CONTROL, 'w-8 px-0')}
      onClick={handleRefresh}
      disabled={isRefreshing}
      aria-label="Refresh"
    >
      <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
    </Button>
  );
}

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
  { name: 'Operator', href: '/operator', icon: Bot },
  { name: 'Workflows', href: '/workflows', icon: Workflow },
  { name: 'Template Library', href: '/templates', icon: Package },
  { name: 'Schedules', href: '/schedules', icon: CalendarClock },
  { name: 'Targets', href: '/targets', icon: Target },
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
  useOperatorNotifications();

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
    if (location.pathname === '/operator' || location.pathname.startsWith('/operator/')) {
      const sessionId = location.pathname.match(/^\/operator\/([^/]+)$/)?.[1];
      return <OperatorTopBarActions sessionId={sessionId} />;
    }
    if (location.pathname === '/workflows') {
      return (
        <Button
          onClick={() => {
            if (!canManageWorkflows) return;
            navigate('/workflows/new');
          }}
          size="sm"
          className={TOP_BAR_BUTTON}
          disabled={!canManageWorkflows}
          aria-disabled={!canManageWorkflows}
          aria-label="New Workflow"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>
            New <span className="hidden md:inline">Workflow</span>
          </span>
        </Button>
      );
    }
    if (location.pathname === '/targets') {
      return (
        <Button
          onClick={() => {
            if (!canManageWorkflows) return;
            navigate('/targets?create=1');
          }}
          size="sm"
          className={TOP_BAR_BUTTON}
          disabled={!canManageWorkflows}
          aria-disabled={!canManageWorkflows}
        >
          <Plus className="h-3.5 w-3.5" />
          <span>
            New <span className="hidden md:inline">target</span>
          </span>
        </Button>
      );
    }
    if (location.pathname === '/webhooks') {
      return <WebhooksTopBarActions />;
    }
    if (location.pathname === '/schedules') {
      return <SchedulesTopBarActions />;
    }
    if (location.pathname === '/templates') {
      return <TemplatesTopBarActions />;
    }
    if (location.pathname === '/action-center') {
      return <ActionCenterTopBarActions />;
    }
    if (location.pathname === '/findings') {
      return <FindingsTopBarActions />;
    }
    if (location.pathname === '/analytics') {
      return <AnalyticsTopBarActions />;
    }
    if (location.pathname === '/artifacts') {
      return <ArtifactsTopBarActions />;
    }
    if (location.pathname === '/secrets') {
      return <SecretsTopBarActions />;
    }
    if (location.pathname === '/api-keys') {
      return <ApiKeysTopBarActions />;
    }
    if (location.pathname === '/agent-skills') {
      return <AgentSkillsTopBarActions />;
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
          <SidebarHeader className="relative flex h-10 shrink-0 items-center justify-center border-b px-2">
            <Link
              to="/"
              className={cn('flex items-center min-w-0 justify-center', sidebarOpen && 'gap-1.5')}
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
                  'overflow-hidden whitespace-nowrap text-sm font-bold transition-[opacity,max-width] duration-300',
                  sidebarOpen ? 'max-w-32 opacity-100' : 'max-w-0 opacity-0',
                )}
              >
                Sentris Flow
              </span>
            </Link>
            {isMobile && sidebarOpen && (
              <button
                onClick={closeMobileSidebar}
                className="absolute right-2 flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
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
