import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark';
type ThemePreference = 'light' | 'dark' | 'system';

interface ThemeState {
  theme: Theme;
  themePreference: ThemePreference;
  isTransitioning: boolean;
  setTheme: (theme: Theme) => void;
  setThemePreference: (preference: ThemePreference) => void;
  toggleTheme: () => void;
  startTransition: () => void;
  endTransition: () => void;
}

function resolveTheme(preference: ThemePreference): Theme {
  if (preference === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return preference;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      themePreference: 'light',
      isTransitioning: false,
      setTheme: (theme) => {
        set({ theme, themePreference: theme });
        applyTheme(theme);
      },
      setThemePreference: (preference) => {
        const resolved = resolveTheme(preference);
        set({ themePreference: preference, theme: resolved });
        applyTheme(resolved);
      },
      toggleTheme: () => {
        const current = get().theme;
        const next = current === 'light' ? 'dark' : 'light';
        // When toggling directly, set explicit preference (not system)
        set({ theme: next, themePreference: next });
        applyTheme(next);
      },
      startTransition: () => set({ isTransitioning: true }),
      endTransition: () => set({ isTransitioning: false }),
    }),
    {
      name: 'sentris-theme',
      partialize: (state) => ({
        theme: state.theme,
        themePreference: state.themePreference,
      }),
      onRehydrateStorage: () => (state) => {
        // Apply theme when store is rehydrated from localStorage
        // Always reset isTransitioning to false on rehydrate to prevent stuck states
        if (state) {
          state.isTransitioning = false;
          // Re-resolve in case system preference changed since last visit
          if (state.themePreference === 'system') {
            state.theme = resolveTheme('system');
          }
          applyTheme(state.theme);
        }
      },
    },
  ),
);

// Listen for system theme changes when preference is 'system'
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    const { themePreference } = useThemeStore.getState();
    if (themePreference === 'system') {
      const resolved: Theme = e.matches ? 'dark' : 'light';
      useThemeStore.setState({ theme: resolved });
      applyTheme(resolved);
    }
  });
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;

  // Disable transitions during the prompt switch to prevent "jank"
  // where different elements transition at different speeds.
  root.classList.add('theme-switching');

  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }

  // Force reflow to flush changes while transitions are disabled
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  root.offsetHeight;

  // Re-enable transitions
  root.classList.remove('theme-switching');
}

// Initialize theme on module load (handles initial page load)
export function initializeTheme() {
  const stored = localStorage.getItem('sentris-theme');
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed?.state?.theme) {
        applyTheme(parsed.state.theme); // No animation on initial load
      }
    } catch {
      // Invalid stored value, use default
    }
  }
}
