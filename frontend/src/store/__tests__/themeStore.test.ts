import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { useThemeStore } from '../themeStore';

// Save original matchMedia
const originalMatchMedia = window.matchMedia;

describe('themeStore', () => {
  beforeEach(() => {
    // Reset store to defaults
    useThemeStore.setState({
      theme: 'light',
      themePreference: 'light',
      isTransitioning: false,
    });
    localStorage.clear();

    // Mock matchMedia for system theme resolution
    window.matchMedia = ((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)' ? false : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    document.documentElement.classList.remove('dark', 'theme-switching');
  });

  it('has correct default values', () => {
    const state = useThemeStore.getState();
    expect(state.theme).toBe('light');
    expect(state.themePreference).toBe('light');
    expect(state.isTransitioning).toBe(false);
  });

  it('sets theme to dark via setTheme', () => {
    useThemeStore.getState().setTheme('dark');
    const state = useThemeStore.getState();
    expect(state.theme).toBe('dark');
    expect(state.themePreference).toBe('dark');
  });

  it('sets theme to light via setTheme', () => {
    useThemeStore.getState().setTheme('dark');
    useThemeStore.getState().setTheme('light');
    const state = useThemeStore.getState();
    expect(state.theme).toBe('light');
    expect(state.themePreference).toBe('light');
  });

  it('toggles theme from light to dark', () => {
    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe('dark');
    expect(useThemeStore.getState().themePreference).toBe('dark');
  });

  it('toggles theme from dark to light', () => {
    useThemeStore.setState({ theme: 'dark', themePreference: 'dark' });
    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe('light');
    expect(useThemeStore.getState().themePreference).toBe('light');
  });

  it('sets themePreference to light explicitly', () => {
    useThemeStore.getState().setThemePreference('light');
    const state = useThemeStore.getState();
    expect(state.themePreference).toBe('light');
    expect(state.theme).toBe('light');
  });

  it('sets themePreference to dark explicitly', () => {
    useThemeStore.getState().setThemePreference('dark');
    const state = useThemeStore.getState();
    expect(state.themePreference).toBe('dark');
    expect(state.theme).toBe('dark');
  });

  it('resolves system preference as light when prefers-color-scheme is light', () => {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;

    useThemeStore.getState().setThemePreference('system');
    const state = useThemeStore.getState();
    expect(state.themePreference).toBe('system');
    expect(state.theme).toBe('light');
  });

  it('resolves system preference as dark when prefers-color-scheme is dark', () => {
    window.matchMedia = ((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;

    useThemeStore.getState().setThemePreference('system');
    const state = useThemeStore.getState();
    expect(state.themePreference).toBe('system');
    expect(state.theme).toBe('dark');
  });

  it('applies dark class to document when theme is dark', () => {
    useThemeStore.getState().setTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('removes dark class from document when theme is light', () => {
    useThemeStore.getState().setTheme('dark');
    useThemeStore.getState().setTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('manages transition state', () => {
    useThemeStore.getState().startTransition();
    expect(useThemeStore.getState().isTransitioning).toBe(true);

    useThemeStore.getState().endTransition();
    expect(useThemeStore.getState().isTransitioning).toBe(false);
  });
});
