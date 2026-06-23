import { Link } from 'react-router-dom';
import { SidebarContent, SidebarFooter, getSidebarItemClassName } from '@/components/ui/sidebar';
import { Settings, ChevronDown, Search, Command, Sun, Moon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useThemeStore } from '@/store/themeStore';
import { useAuth, useAuthProvider } from '@/auth/auth-context';
import { UserButton } from '@/components/auth/UserButton';
import { NotificationCenter } from '@/components/layout/NotificationCenter';
import { useIsMac } from '@/hooks/useIsMac';
import { prefetchRoute } from '@/lib/prefetch-routes';

const footerIconButtonClass =
  'h-9 w-9 min-h-9 min-w-9 shrink-0 flex items-center justify-center rounded-lg p-0';

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
  const collapsedIconButtonClass = isCompact
    ? 'h-8 w-8 min-h-8 px-0 py-0 mx-auto justify-center gap-0'
    : 'h-10 w-10 min-h-10 px-0 py-0 mx-auto justify-center gap-0';

  return (
    <>
      <SidebarContent className="py-0">
        <nav aria-label="Main navigation">
          <ul className={cn('list-none px-2 mt-2', isCompact ? 'space-y-0.5' : 'space-y-1')}>
            {navigationItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              const isExternal = Boolean(item.external);

              if (isExternal) {
                return (
                  <li key={item.href}>
                    <a
                      href={item.href}
                      className={getSidebarItemClassName(
                        false,
                        cn(
                          'flex items-center',
                          isCompact ? 'gap-2 py-1.5 md:py-1 min-h-[36px] md:min-h-0' : 'gap-2.5 py-1.5',
                          sidebarOpen ? 'justify-start px-3' : collapsedIconButtonClass,
                        ),
                      )}
                      onClick={(e) => {
                        e.preventDefault();
                        if (isMobile) onMobileClose();
                        window.open(item.href, '_blank', 'noopener,noreferrer');
                      }}
                    >
                      <Icon className={cn('flex-shrink-0', isCompact ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
                      <NavLabel sidebarOpen={sidebarOpen} isCompact={isCompact}>
                        {item.name}
                      </NavLabel>
                    </a>
                  </li>
                );
              }

              return (
                <li key={item.href}>
                  <Link
                    to={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={getSidebarItemClassName(
                      active,
                      cn(
                        'flex items-center',
                        isCompact ? 'gap-2 py-1.5 md:py-1 min-h-[36px] md:min-h-0' : 'gap-2.5 py-1.5',
                        sidebarOpen ? 'justify-start px-3' : collapsedIconButtonClass,
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
                    <Icon className={cn('flex-shrink-0', isCompact ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
                    <NavLabel sidebarOpen={sidebarOpen} isCompact={isCompact}>
                      {item.name}
                    </NavLabel>
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Manage Collapsible Section */}
          <div className="px-2 mt-2">
            <button
              onClick={onSettingsToggle}
              aria-expanded={settingsOpen}
              aria-controls="manage-nav-section"
              className={cn(
                'w-full flex items-center rounded-lg transition-colors',
                isCompact ? 'gap-2 py-1.5' : 'gap-2.5 py-1.5',
                'hover:bg-muted/50 text-muted-foreground hover:text-foreground',
                sidebarOpen ? 'justify-between px-3' : collapsedIconButtonClass,
              )}
            >
              <div
                className={cn(
                  'flex items-center',
                  sidebarOpen ? (isCompact ? 'gap-2' : 'gap-2.5') : 'gap-0 justify-center',
                )}
              >
                <Settings className={cn('flex-shrink-0', isCompact ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
                <NavLabel sidebarOpen={sidebarOpen} isCompact={isCompact} fontWeight="font-medium">
                  Manage
                </NavLabel>
              </div>
              {sidebarOpen && (
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 transition-transform duration-200 flex-shrink-0',
                    settingsOpen ? 'rotate-180' : '',
                  )}
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
                  <li key={item.href}>
                    <Link
                      to={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={getSidebarItemClassName(
                        active,
                        cn(
                          'flex items-center',
                          isCompact ? 'gap-2 py-1.5 md:py-1 min-h-[36px] md:min-h-0' : 'gap-2.5 py-1.5',
                          sidebarOpen ? 'justify-start px-3' : collapsedIconButtonClass,
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
                        className={cn('flex-shrink-0', isCompact ? 'h-3 w-3' : 'h-3.5 w-3.5')}
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
        <div className="px-2 pt-2 pb-1">
          <button
            onClick={onOpenCommandPalette}
            className={cn(
              'w-full flex items-center gap-2.5 py-2 rounded-lg transition-colors',
              'bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground',
              sidebarOpen ? 'justify-between px-3' : collapsedIconButtonClass,
            )}
            aria-label="Open command palette"
          >
            <div
              className={cn('flex items-center', sidebarOpen ? 'gap-2.5' : 'gap-0 justify-center')}
            >
              <Search className="h-3.5 w-3.5 flex-shrink-0" />
              <NavLabel sidebarOpen={sidebarOpen} isCompact={false}>
                Search...
              </NavLabel>
            </div>
            {sidebarOpen && (
              <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded border border-border/60 bg-background/80 px-1.5 font-mono text-xs font-medium text-muted-foreground">
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

        <div
          className={cn(
            'p-1.5',
            sidebarOpen ? 'flex items-center gap-1' : 'flex flex-col items-center gap-1.5',
          )}
        >
          {showUserButton && (
            <UserButton
              className={cn(sidebarOpen ? 'min-w-0 flex-1' : 'w-auto mx-auto')}
              sidebarCollapsed={!sidebarOpen}
            />
          )}
          <div className="flex shrink-0 items-center">
            <NotificationCenter className={footerIconButtonClass} popoverSide="top" />
            {sidebarOpen && (
              <ThemeToggleButton
                theme={theme}
                onToggle={startTransition}
                className={footerIconButtonClass}
              />
            )}
          </div>
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
        'transition-all duration-300 whitespace-nowrap overflow-hidden flex-1',
        isCompact ? 'text-[11px]' : 'text-xs',
        fontWeight,
        sidebarOpen ? 'opacity-100' : 'opacity-0 max-w-0',
      )}
      style={{
        transitionDelay: sidebarOpen ? '200ms' : '0ms',
        transitionProperty: 'opacity, max-width',
      }}
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
        <Sun className="h-4 w-4 text-amber-500" />
      ) : (
        <Moon className="h-4 w-4 text-slate-600 dark:text-slate-400" />
      )}
    </button>
  );
}
