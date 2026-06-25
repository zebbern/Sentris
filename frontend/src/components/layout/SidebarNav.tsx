import { Link } from 'react-router-dom';
import { SidebarContent, SidebarFooter, getSidebarItemClassName } from '@/components/ui/sidebar';
import { Settings, ChevronDown, Search, Command, Sun, Moon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useThemeStore } from '@/store/themeStore';
import { useAuth, useAuthProvider } from '@/auth/auth-context';
import { UserButton } from '@/components/auth/UserButton';
import { useIsMac } from '@/hooks/useIsMac';
import { prefetchRoute } from '@/lib/prefetch-routes';

const footerIconButtonClass =
  'h-7 w-7 min-h-7 min-w-7 shrink-0 flex items-center justify-center rounded-md p-0';

export interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  external?: boolean;
  newTab?: boolean;
}

interface SidebarNavProps {
  sidebarOpen: boolean;
  isMobile: boolean;
  isCompact: boolean;
  navigationItems: NavItem[];
  settingsItems: NavItem[];
  settingsOpen: boolean;
  onSettingsToggle: () => void;
  onOpenCommandPalette: () => void;
  isActive: (path: string) => boolean;
  onMobileClose: () => void;
  onDesktopNavClick: (href: string) => void;
}

export function SidebarNav({
  sidebarOpen,
  isMobile,
  isCompact,
  navigationItems,
  settingsItems,
  settingsOpen,
  onSettingsToggle,
  onOpenCommandPalette,
  isActive,
  onMobileClose,
  onDesktopNavClick,
}: SidebarNavProps) {
  const isMac = useIsMac();
  const theme = useThemeStore((s) => s.theme);
  const startTransition = useThemeStore((s) => s.startTransition);
  const { isAuthenticated } = useAuth();
  const authProvider = useAuthProvider();
  const showUserButton = isAuthenticated || authProvider.name === 'clerk';
  const collapsedNavItemClass =
    'h-10 w-10 min-h-10 min-w-10 max-w-10 shrink-0 p-0 mx-auto flex items-center justify-center gap-0';
  const expandedNavItemClass = isCompact
    ? 'w-full justify-start px-2.5 gap-2 py-2 md:py-1.5 min-h-[40px] md:min-h-0'
    : 'w-full justify-start px-2.5 gap-2.5 py-2';

  return (
    <>
      <SidebarContent className="py-0">
        <div className={cn('px-1.5 pt-1.5 pb-0.5', !sidebarOpen && 'flex justify-center')}>
          <button
            onClick={onOpenCommandPalette}
            className={cn(
              'flex items-center rounded-md transition-colors',
              'bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground',
              sidebarOpen ? 'w-full gap-2 py-2 justify-between px-2.5' : collapsedNavItemClass,
            )}
            aria-label="Open command palette"
          >
            {sidebarOpen ? (
              <>
                <div className="flex items-center gap-2">
                  <Search className="h-3.5 w-3.5 flex-shrink-0" />
                  <NavLabel sidebarOpen={sidebarOpen} isCompact={false}>
                    Search...
                  </NavLabel>
                </div>
                <kbd className="hidden sm:inline-flex h-[18px] items-center gap-0.5 rounded border border-border/60 bg-background/80 px-1 font-mono text-[11px] font-medium text-muted-foreground">
                  {isMac ? (
                    <>
                      <Command className="h-2.5 w-2.5" />K
                    </>
                  ) : (
                    'Ctrl+K'
                  )}
                </kbd>
              </>
            ) : (
              <Search className="h-3.5 w-3.5 flex-shrink-0" />
            )}
          </button>
        </div>

        <nav aria-label="Main navigation">
          <ul className={cn('list-none px-1.5 mt-0.5', isCompact ? 'space-y-0.5' : 'space-y-1')}>
            {navigationItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              const isExternal = Boolean(item.external);

              if (isExternal) {
                return (
                  <li key={item.href} className={cn(!sidebarOpen && 'flex justify-center')}>
                    <a
                      href={item.href}
                      className={getSidebarItemClassName(
                        false,
                        cn(
                          'flex items-center',
                          sidebarOpen ? expandedNavItemClass : collapsedNavItemClass,
                        ),
                      )}
                      onClick={(e) => {
                        e.preventDefault();
                        if (isMobile) onMobileClose();
                        window.open(item.href, '_blank', 'noopener,noreferrer');
                      }}
                    >
                      <Icon
                        className={cn('flex-shrink-0', isCompact ? 'h-4 w-4' : 'h-[18px] w-[18px]')}
                      />
                      <NavLabel sidebarOpen={sidebarOpen} isCompact={isCompact}>
                        {item.name}
                      </NavLabel>
                    </a>
                  </li>
                );
              }

              return (
                <li key={item.href} className={cn(!sidebarOpen && 'flex justify-center')}>
                  <Link
                    to={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={getSidebarItemClassName(
                      active,
                      cn(
                        'flex items-center',
                        sidebarOpen ? expandedNavItemClass : collapsedNavItemClass,
                      ),
                    )}
                    onMouseEnter={() => prefetchRoute(item.href)}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                      if (isMobile) {
                        onMobileClose();
                        return;
                      }
                      onDesktopNavClick(item.href);
                    }}
                  >
                    <Icon
                      className={cn('flex-shrink-0', isCompact ? 'h-4 w-4' : 'h-[18px] w-[18px]')}
                    />
                    <NavLabel sidebarOpen={sidebarOpen} isCompact={isCompact}>
                      {item.name}
                    </NavLabel>
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Manage Collapsible Section */}
          <div className={cn('px-1.5 mt-1', !sidebarOpen && 'flex flex-col items-center')}>
            <button
              onClick={onSettingsToggle}
              aria-expanded={settingsOpen}
              aria-controls="manage-nav-section"
              aria-label={sidebarOpen ? undefined : 'Manage'}
              className={cn(
                'flex items-center rounded-lg transition-colors',
                'hover:bg-muted/50 text-muted-foreground hover:text-foreground',
                sidebarOpen
                  ? cn(
                      'w-full',
                      isCompact
                        ? 'gap-2 py-2 justify-between px-2.5'
                        : 'gap-2.5 py-2 justify-between px-2.5',
                    )
                  : collapsedNavItemClass,
              )}
            >
              {sidebarOpen ? (
                <>
                  <div className={cn('flex items-center', isCompact ? 'gap-2' : 'gap-2.5')}>
                    <Settings
                      className={cn('flex-shrink-0', isCompact ? 'h-4 w-4' : 'h-[18px] w-[18px]')}
                    />
                    <NavLabel
                      sidebarOpen={sidebarOpen}
                      isCompact={isCompact}
                      fontWeight="font-medium"
                    >
                      Manage
                    </NavLabel>
                  </div>
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 transition-transform duration-200 flex-shrink-0',
                      settingsOpen ? 'rotate-180' : '',
                    )}
                  />
                </>
              ) : (
                <Settings
                  className={cn('flex-shrink-0', isCompact ? 'h-4 w-4' : 'h-[18px] w-[18px]')}
                />
              )}
            </button>

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
                  <li key={item.href} className={cn(!sidebarOpen && 'flex justify-center')}>
                    <Link
                      to={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={getSidebarItemClassName(
                        active,
                        cn(
                          'flex items-center',
                          sidebarOpen ? expandedNavItemClass : collapsedNavItemClass,
                        ),
                      )}
                      onMouseEnter={() => prefetchRoute(item.href)}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                        if (isMobile) {
                          onMobileClose();
                          return;
                        }
                        onDesktopNavClick(item.href);
                      }}
                    >
                      <Icon
                        className={cn('flex-shrink-0', isCompact ? 'h-3.5 w-3.5' : 'h-4 w-4')}
                      />
                      <NavLabel sidebarOpen={sidebarOpen} isCompact={isCompact}>
                        {item.name}
                      </NavLabel>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </nav>
      </SidebarContent>

      <SidebarFooter className="border-t p-0">
        <div
          className={cn(
            'px-1 py-0.5',
            sidebarOpen ? 'flex items-center gap-0.5' : 'flex flex-col items-center gap-0.5',
          )}
        >
          {showUserButton && (
            <UserButton
              compact
              integratedNotifications
              className={cn(sidebarOpen ? 'min-w-0 flex-1' : 'w-auto mx-auto')}
              sidebarCollapsed={!sidebarOpen}
            />
          )}
          {sidebarOpen && (
            <ThemeToggleButton
              theme={theme}
              onToggle={startTransition}
              className={footerIconButtonClass}
            />
          )}
        </div>
      </SidebarFooter>
    </>
  );
}

/* ── Internal helpers ─────────────────────────────────────────────── */

function NavLabel({
  sidebarOpen,
  isCompact,
  fontWeight,
  children,
}: {
  sidebarOpen: boolean;
  isCompact: boolean;
  fontWeight?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'transition-all duration-300 whitespace-nowrap overflow-hidden',
        isCompact ? 'text-xs' : 'text-[13px]',
        fontWeight,
        sidebarOpen ? 'flex-1 opacity-100' : 'hidden',
      )}
      style={
        sidebarOpen
          ? {
              transitionDelay: '200ms',
              transitionProperty: 'opacity, max-width',
            }
          : undefined
      }
    >
      {children}
    </span>
  );
}

function ThemeToggleButton({
  theme,
  onToggle,
  className,
}: {
  theme: string;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        'transition-colors hover:bg-accent hover:text-accent-foreground text-muted-foreground',
        className,
      )}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {theme === 'dark' ? (
        <Sun className="h-3 w-3 text-amber-500" />
      ) : (
        <Moon className="h-3 w-3 text-slate-600 dark:text-slate-400" />
      )}
    </button>
  );
}
