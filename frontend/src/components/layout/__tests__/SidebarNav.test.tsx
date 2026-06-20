import { describe, it, expect, afterEach, beforeAll, mock } from 'bun:test';
import { cleanup, screen } from '@testing-library/react';
import { Box, ShieldAlert } from 'lucide-react';
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
  useAuth: () => ({ isAuthenticated: false }),
  useAuthProvider: () => ({ name: 'local' }),
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
        displayVersion="test"
        isActive={(path) => path === '/findings'}
        onMobileClose={mock(() => {})}
        onDesktopNavClick={mock(() => {})}
      />,
      { initialEntries: ['/findings'] },
    );

    const findingsButton = screen.getByRole('button', { name: /findings/i });
    const manageButton = screen.getByRole('button', { name: /manage/i });
    const searchButton = screen.getByRole('button', { name: /open command palette/i });

    for (const button of [findingsButton, manageButton, searchButton]) {
      expect(button.className).toContain('h-11');
      expect(button.className).toContain('w-11');
      expect(button.className).toContain('px-0');
      expect(button.className).toContain('mx-auto');
    }
  });
});
