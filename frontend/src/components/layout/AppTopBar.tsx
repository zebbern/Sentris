import { useLocation, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Route → page info config map
// ---------------------------------------------------------------------------

interface PageInfo {
  title: string;
  shortTitle?: string;
  subtitle: string;
}

interface RouteEntry extends PageInfo {
  path: string;
  /** When true, matches any pathname starting with `path`. */
  prefix?: boolean;
}

const ROUTE_CONFIG: RouteEntry[] = [
  {
    path: '/',
    title: 'Dashboard',
    shortTitle: 'Dashboard',
    subtitle: 'Security automation overview',
  },
  {
    path: '/templates',
    title: 'Template Library',
    shortTitle: 'Templates',
    subtitle: 'Browse and use pre-built workflow templates',
  },
  {
    path: '/secrets',
    title: 'Secrets',
    shortTitle: 'Secrets',
    subtitle: 'Store and manage sensitive credentials',
  },
  {
    path: '/webhooks',
    title: 'Webhooks Manager',
    shortTitle: 'Webhooks',
    subtitle: 'Manage and debug incoming webhooks',
  },
  {
    path: '/api-keys',
    title: 'API Keys',
    shortTitle: 'API Keys',
    subtitle: 'Manage API keys for workflow triggers',
  },
  {
    path: '/integrations',
    title: 'Connections',
    shortTitle: 'Connections',
    subtitle: 'Manage third-party connections',
  },
  {
    path: '/artifacts',
    title: 'Artifact Library',
    shortTitle: 'Artifacts',
    subtitle: 'Browse artifacts saved across workflow runs',
  },
  {
    path: '/action-center',
    title: 'Action Center',
    shortTitle: 'Action Center',
    subtitle: 'Review and respond to pending items',
  },
  {
    path: '/mcp-library',
    title: 'MCP Servers',
    shortTitle: 'MCP Servers',
    subtitle: 'Discover and manage MCP server configurations',
  },
  {
    path: '/analytics-settings',
    title: 'Analytics Settings',
    shortTitle: 'Analytics Settings',
    subtitle: 'Configure data retention and storage settings',
  },
  // Prefix matches (must come after exact matches for the same prefix)
  {
    path: '/workflows',
    prefix: true,
    title: 'Workflow Builder',
    shortTitle: 'Builder',
    subtitle: 'Design and automate security workflows',
  },
  {
    path: '/schedules',
    prefix: true,
    title: 'Workflow Schedules',
    shortTitle: 'Schedules',
    subtitle: 'Manage recurring workflow cadences',
  },
  {
    path: '/settings',
    prefix: true,
    title: 'Settings',
    shortTitle: 'Settings',
    subtitle: 'Organization and workspace configuration',
  },
];

const FALLBACK_PAGE_INFO: PageInfo = {
  title: 'Page Not Found',
  shortTitle: 'Not Found',
  subtitle: '',
};

function getPageInfo(
  pathname: string,
  titleOverride?: string,
  subtitleOverride?: string,
): PageInfo {
  if (titleOverride) return { title: titleOverride, subtitle: subtitleOverride ?? '' };

  for (const route of ROUTE_CONFIG) {
    if (route.prefix ? pathname.startsWith(route.path) : pathname === route.path) {
      return route;
    }
  }

  return FALLBACK_PAGE_INFO;
}

interface AppTopBarProps {
  title?: string;
  subtitle?: string;
  showSidebarToggle?: boolean;
  sidebarOpen?: boolean;
  onSidebarToggle?: () => void;
  actions?: React.ReactNode;
  isMobile?: boolean;
}

export function AppTopBar({
  title,
  subtitle,
  showSidebarToggle = true,
  sidebarOpen,
  onSidebarToggle,
  actions,
  isMobile = false,
}: AppTopBarProps) {
  const location = useLocation();

  const pageInfo = getPageInfo(location.pathname, title, subtitle);

  return (
    <div
      className={cn(
        'h-[56px] md:h-[60px] border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60',
        'flex items-center px-3 md:px-4 gap-2 md:gap-4 sticky top-0 z-40',
      )}
    >
      {/* Sidebar toggle - works on both mobile and desktop */}
      {showSidebarToggle && onSidebarToggle && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onSidebarToggle}
          aria-label={
            isMobile
              ? sidebarOpen
                ? 'Close menu'
                : 'Open menu'
              : sidebarOpen
                ? 'Collapse sidebar'
                : 'Expand sidebar'
          }
          className="h-9 w-9 min-h-11 min-w-11 flex-shrink-0"
        >
          {sidebarOpen ? (
            <PanelLeftClose className="h-5 w-5" />
          ) : (
            <PanelLeftOpen className="h-5 w-5" />
          )}
        </Button>
      )}

      {/* Logo and Page title section */}
      <div className="flex items-center min-w-0 flex-1 gap-3">
        {/* Mobile: Sentris Flow stacked | Page Title (except on workflows page) */}
        {isMobile ? (
          <div className="flex items-center gap-2 min-w-0">
            <Link to="/" className="flex items-center gap-1.5 flex-shrink-0">
              <img
                src="/favicon.ico"
                alt="Sentris"
                width={24}
                height={24}
                className="w-6 h-6"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
              <div className="flex flex-col leading-none">
                <span className="font-bold text-base">Sentris</span>
                <span className="text-xs text-muted-foreground font-medium -mt-1.5">Flow</span>
              </div>
            </Link>
            {/* Show page title on non-workflow pages */}
            {location.pathname !== '/' && !location.pathname.startsWith('/workflows') && (
              <>
                <span className="text-muted-foreground">|</span>
                <span className="font-medium text-sm truncate">
                  {pageInfo.shortTitle || pageInfo.title}
                </span>
              </>
            )}
          </div>
        ) : (
          /* Desktop: Full page title — responsive sizing for tablet */
          <div className="min-w-0">
            <h1 className="text-base lg:text-xl font-semibold truncate">
              <span className="lg:hidden">{pageInfo.shortTitle || pageInfo.title}</span>
              <span className="hidden lg:inline">{pageInfo.title}</span>
            </h1>
            {pageInfo.subtitle && (
              <p className="text-sm text-muted-foreground truncate hidden lg:block">
                {pageInfo.subtitle}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">{actions}</div>
    </div>
  );
}
