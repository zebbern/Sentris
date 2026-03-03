import { Link } from 'react-router-dom';
import { SidebarContent, SidebarFooter, SidebarItem } from '@/components/ui/sidebar';
import { Settings, ChevronDown, Search, Command, Sun, Moon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useThemeStore } from '@/store/themeStore';
import { useAuth, useAuthProvider } from '@/auth/auth-context';
import { UserButton } from '@/components/auth/UserButton';
import { useIsMac } from '@/hooks/useIsMac';
import { prefetchRoute } from '@/lib/prefetch-routes';

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
  displayVersion: string;
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
  displayVersion,
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

  return (
    <>
      <SidebarContent className="py-0">
        <nav aria-label="Main navigation">
          <ul className={cn('list-none px-2 mt-2', isCompact ? 'space-y-0.5' : 'space-y-1')}>
            {navigationItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              const isExternal = Boolean(item.external);
              const openInNewTab = isExternal ? item.newTab !== false : true;

              if (isExternal) {
                return (
                  <li key={item.href}>
                    <a
                      href={item.href}
                      target={openInNewTab ? '_blank' : undefined}
                      rel={openInNewTab ? 'noopener noreferrer' : undefined}
                      onClick={() => {
                        if (isMobile) onMobileClose();
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
                        <Icon className={cn('flex-shrink-0', isCompact ? 'h-4 w-4' : 'h-5 w-5')} />
                        <NavLabel sidebarOpen={sidebarOpen} isCompact={isCompact}>
                          {item.name}
                        </NavLabel>
                      </SidebarItem>
                    </a>
                  </li>
                );
              }

              return (
                <li key={item.href}>
                  <Link
                    to={item.href}
                    aria-current={active ? 'page' : undefined}
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
                    <SidebarItem
                      isActive={active}
                      className={cn(
                        'flex items-center',
                        isCompact ? 'gap-2 py-1.5 md:py-1 min-h-[36px] md:min-h-0' : 'gap-3',
                        sidebarOpen ? 'justify-start px-4' : 'justify-center',
                      )}
                    >
                      <Icon className={cn('flex-shrink-0', isCompact ? 'h-4 w-4' : 'h-5 w-5')} />
                      <NavLabel sidebarOpen={sidebarOpen} isCompact={isCompact}>
                        {item.name}
                      </NavLabel>
                    </SidebarItem>
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
                isCompact ? 'gap-2 py-1.5' : 'gap-3 py-2',
                'hover:bg-muted/50 text-muted-foreground hover:text-foreground',
                sidebarOpen ? 'justify-between px-4' : 'justify-center',
              )}
            >
              <div className={cn('flex items-center', isCompact ? 'gap-2' : 'gap-3')}>
                <Settings className={cn('flex-shrink-0', isCompact ? 'h-4 w-4' : 'h-5 w-5')} />
                <NavLabel sidebarOpen={sidebarOpen} isCompact={isCompact} fontWeight="font-medium">
                  Manage
                </NavLabel>
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
                        <NavLabel sidebarOpen={sidebarOpen} isCompact={isCompact}>
                          {item.name}
                        </NavLabel>
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
            onClick={onOpenCommandPalette}
            className={cn(
              'w-full flex items-center gap-3 py-2.5 rounded-lg transition-colors',
              'bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground',
              sidebarOpen ? 'justify-between px-4' : 'justify-center',
            )}
            aria-label="Open command palette"
          >
            <div className="flex items-center gap-3">
              <Search className="h-4 w-4 flex-shrink-0" />
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
      </SidebarContent>

      <SidebarFooter className="border-t p-0">
        <div className="flex flex-col gap-1.5 p-1">
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
              {sidebarOpen && <ThemeToggleButton theme={theme} onToggle={startTransition} />}
            </div>
          )}
          {!showUserButton && (
            <div className={cn('flex', sidebarOpen ? 'justify-end' : 'justify-center')}>
              <ThemeToggleButton theme={theme} onToggle={startTransition} />
            </div>
          )}
        </div>
      </SidebarFooter>

      {/* Version info */}
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
        isCompact ? 'text-xs' : 'text-sm',
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

function ThemeToggleButton({ theme, onToggle }: { theme: string; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="p-2.5 rounded-lg transition-colors hover:bg-accent hover:text-accent-foreground text-muted-foreground flex-shrink-0 min-h-11 min-w-11 flex items-center justify-center"
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {theme === 'dark' ? (
        <Sun className="h-5 w-5 text-amber-500" />
      ) : (
        <Moon className="h-5 w-5 text-slate-600 dark:text-slate-400" />
      )}
    </button>
  );
}
