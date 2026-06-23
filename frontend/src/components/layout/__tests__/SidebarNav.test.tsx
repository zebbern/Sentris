import { describe, it, expect, afterEach, beforeAll, mock } from 'bun:test';
import { cleanup, screen, fireEvent } from '@testing-library/react';
import { BarChart3, Box, ShieldAlert } from 'lucide-react';
import { renderWithProviders } from '@/test/render-with-providers';

mock.module('@/store/themeStore', () => {
  const state = {
    theme: 'dark',
    startTransition: mock(() => {}),
  };

  return {
    useThemeStore: (selector?: (s: typeof state) => unknown) =>
      selector ? selector(state) : state,
  };
});

mock.module('@/auth/auth-context', () => ({
  useAuth: () => ({ isAuthenticated: true }),
  useAuthProvider: () => ({ name: 'local' }),
}));

mock.module('@/components/auth/UserButton', () => ({
  UserButton: ({ sidebarCollapsed }: { sidebarCollapsed?: boolean }) => (
    <button type="button">{sidebarCollapsed ? 'Avatar' : 'User profile'}</button>
  ),
}));

mock.module('@/hooks/useIsMac', () => ({
  useIsMac: () => false,
}));

let SidebarNav: typeof import('../SidebarNav').SidebarNav;

beforeAll(async () => {
  SidebarNav = (await import('../SidebarNav')).SidebarNav;
});

afterEach(cleanup);

describe('SidebarNav', () => {
  it('uses fixed square icon targets when collapsed', () => {
    renderWithProviders(
      <SidebarNav
        sidebarOpen={false}
        isMobile={false}
        isCompact={false}
        navigationItems={[{ name: 'Findings', href: '/findings', icon: ShieldAlert }]}
        settingsItems={[{ name: 'Assets', href: '/assets', icon: Box }]}
        settingsOpen={false}
        onSettingsToggle={mock(() => {})}
        onOpenCommandPalette={mock(() => {})}
        isActive={(path) => path === '/findings'}
        onMobileClose={mock(() => {})}
        onDesktopNavClick={mock(() => {})}
      />,
      { initialEntries: ['/findings'] },
    );

    const findingsLink = screen.getByRole('link', { name: /findings/i });
    const manageButton = screen.getByRole('button', { name: /manage/i });
    const searchButton = screen.getByRole('button', { name: /open command palette/i });

    for (const target of [findingsLink, manageButton, searchButton]) {
      expect(target.className).toContain('h-10');
      expect(target.className).toContain('w-10');
      expect(target.className).toContain('px-0');
      expect(target.className).toContain('mx-auto');
    }

    expect(screen.getByRole('button', { name: /notifications/i })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /switch to (light|dark) mode/i }),
    ).not.toBeInTheDocument();
  });

  it('shows theme toggle beside notifications when sidebar is expanded', () => {
    renderWithProviders(
      <SidebarNav
        sidebarOpen={true}
        isMobile={false}
        isCompact={false}
        navigationItems={[{ name: 'Findings', href: '/findings', icon: ShieldAlert }]}
        settingsItems={[]}
        settingsOpen={false}
        onSettingsToggle={mock(() => {})}
        onOpenCommandPalette={mock(() => {})}
        isActive={() => false}
        onMobileClose={mock(() => {})}
        onDesktopNavClick={mock(() => {})}
      />,
      { initialEntries: ['/findings'] },
    );

    expect(screen.getByRole('button', { name: /notifications/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /switch to light mode/i })).toBeInTheDocument();
  });

  it('opens external nav links in a single new tab', () => {
    const openSpy = mock(() => window);
    const originalOpen = window.open;
    window.open = openSpy as typeof window.open;

    try {
      renderWithProviders(
        <SidebarNav
          sidebarOpen={true}
          isMobile={false}
          isCompact={false}
          navigationItems={[
            {
              name: 'Dashboards',
              href: 'http://localhost/analytics',
              icon: BarChart3,
              external: true,
            },
          ]}
          settingsItems={[]}
          settingsOpen={false}
          onSettingsToggle={mock(() => {})}
          onOpenCommandPalette={mock(() => {})}
          isActive={() => false}
          onMobileClose={mock(() => {})}
          onDesktopNavClick={mock(() => {})}
        />,
        { initialEntries: ['/'] },
      );

      fireEvent.click(screen.getByRole('link', { name: /dashboards/i }));

      expect(openSpy).toHaveBeenCalledTimes(1);
      expect(openSpy).toHaveBeenCalledWith(
        'http://localhost/analytics',
        '_blank',
        'noopener,noreferrer',
      );
    } finally {
      window.open = originalOpen;
    }
  });
});
