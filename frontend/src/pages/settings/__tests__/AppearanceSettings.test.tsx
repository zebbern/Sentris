import { describe, it, expect, beforeEach, beforeAll, afterEach, mock } from 'bun:test';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mutable mock state
// ---------------------------------------------------------------------------

let mockThemePreference: 'light' | 'dark' | 'system' = 'light';
const mockSetThemePreference = mock((pref: 'light' | 'dark' | 'system') => {
  mockThemePreference = pref;
});

mock.module('@/store/themeStore', () => {
  const _state: Record<string, any> = {
    theme: 'light',
    themePreference: 'light' as const,
    isTransitioning: false,
    setTheme: (theme: string) => {
      Object.assign(_state, { theme, themePreference: theme });
      document.documentElement.classList.toggle('dark', theme === 'dark');
    },
    setThemePreference: mockSetThemePreference,
    toggleTheme: () => {
      const next = _state.theme === 'light' ? 'dark' : 'light';
      _state.setTheme(next);
    },
    startTransition: () => {
      _state.isTransitioning = true;
    },
    endTransition: () => {
      _state.isTransitioning = false;
    },
  };
  const useThemeStore = ((selector?: any) => {
    // Read from mutable var on each call for test-controlled state
    const state = {
      ..._state,
      themePreference: mockThemePreference,
      theme: mockThemePreference === 'system' ? 'light' : mockThemePreference,
    };
    return selector ? selector(state) : state;
  }) as any;
  useThemeStore.setState = (partial: any) => {
    const next = typeof partial === 'function' ? partial(_state) : partial;
    Object.assign(_state, next);
    if (next && 'themePreference' in next) mockThemePreference = next.themePreference;
  };
  useThemeStore.getState = () => ({
    ..._state,
    themePreference: mockThemePreference,
    theme: mockThemePreference === 'system' ? 'light' : mockThemePreference,
  });
  useThemeStore.subscribe = () => () => {};
  useThemeStore.destroy = () => {};
  return { useThemeStore };
});

// Dynamic import to ensure mock.module takes effect before the component loads
let AppearanceSettings: React.ComponentType;

beforeAll(async () => {
  const mod = await import('../AppearanceSettings');
  AppearanceSettings = mod.AppearanceSettings;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetMocks() {
  mockThemePreference = 'light';
  mockSetThemePreference.mockClear();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AppearanceSettings', () => {
  beforeEach(() => {
    cleanup();
    resetMocks();
  });

  afterEach(cleanup);

  it('renders the Theme label and description', () => {
    render(<AppearanceSettings />);

    expect(screen.getByText('Theme')).toBeTruthy();
    expect(screen.getByText('Select your preferred color scheme.')).toBeTruthy();
  });

  it('renders three theme options: Light, Dark, System', () => {
    render(<AppearanceSettings />);

    expect(screen.getByText('Light')).toBeTruthy();
    expect(screen.getByText('Dark')).toBeTruthy();
    expect(screen.getByText('System')).toBeTruthy();
  });

  it('renders a radiogroup container', () => {
    render(<AppearanceSettings />);

    const radioGroup = screen.getByRole('radiogroup', { name: /theme preference/i });
    expect(radioGroup).toBeTruthy();
  });

  it('renders three radio buttons', () => {
    render(<AppearanceSettings />);

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
  });

  it('marks Light as checked when themePreference is light', () => {
    mockThemePreference = 'light';
    render(<AppearanceSettings />);

    const radios = screen.getAllByRole('radio');
    const lightRadio = radios.find((r) => r.textContent?.includes('Light'));
    expect(lightRadio?.getAttribute('aria-checked')).toBe('true');
  });

  it('marks Dark as checked when themePreference is dark', () => {
    mockThemePreference = 'dark';
    render(<AppearanceSettings />);

    const radios = screen.getAllByRole('radio');
    const darkRadio = radios.find((r) => r.textContent?.includes('Dark'));
    expect(darkRadio?.getAttribute('aria-checked')).toBe('true');
  });

  it('marks System as checked when themePreference is system', () => {
    mockThemePreference = 'system';
    render(<AppearanceSettings />);

    const radios = screen.getAllByRole('radio');
    const systemRadio = radios.find((r) => r.textContent?.includes('System'));
    expect(systemRadio?.getAttribute('aria-checked')).toBe('true');
  });

  it('calls setThemePreference with dark when Dark is clicked', () => {
    mockThemePreference = 'light';
    render(<AppearanceSettings />);

    const radios = screen.getAllByRole('radio');
    const darkRadio = radios.find((r) => r.textContent?.includes('Dark'));
    fireEvent.click(darkRadio!);

    expect(mockSetThemePreference).toHaveBeenCalledWith('dark');
  });

  it('calls setThemePreference with system when System is clicked', () => {
    mockThemePreference = 'light';
    render(<AppearanceSettings />);

    const radios = screen.getAllByRole('radio');
    const systemRadio = radios.find((r) => r.textContent?.includes('System'));
    fireEvent.click(systemRadio!);

    expect(mockSetThemePreference).toHaveBeenCalledWith('system');
  });

  it('calls setThemePreference with light when Light is clicked', () => {
    mockThemePreference = 'dark';
    render(<AppearanceSettings />);

    const radios = screen.getAllByRole('radio');
    const lightRadio = radios.find((r) => r.textContent?.includes('Light'));
    fireEvent.click(lightRadio!);

    expect(mockSetThemePreference).toHaveBeenCalledWith('light');
  });

  it('shows description text for each theme option', () => {
    render(<AppearanceSettings />);

    expect(screen.getByText(/clean, bright interface/i)).toBeTruthy();
    expect(screen.getByText(/easy on the eyes/i)).toBeTruthy();
    expect(screen.getByText(/automatically matches/i)).toBeTruthy();
  });
});
