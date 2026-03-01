import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { createSelectMock } from '@/test/mocks/radix-select';

// ---------------------------------------------------------------------------
// Mutable mock state
// ---------------------------------------------------------------------------

let mockDefaultLandingPage = '/';
let mockSidebarDensity: 'compact' | 'comfortable' = 'comfortable';
const mockSetDefaultLandingPage = mock((page: string) => {
  mockDefaultLandingPage = page;
});
const mockSetSidebarDensity = mock((density: 'compact' | 'comfortable') => {
  mockSidebarDensity = density;
});

mock.module('@/components/ui/select', createSelectMock);

mock.module('@/store/userPreferencesStore', () => {
  const _state: Record<string, any> = {
    defaultLandingPage: '/',
    sidebarDensity: 'comfortable' as const,
    notifyOnRunComplete: false,
    notifyOnRunFailed: false,
    notifyOnScheduleTriggered: false,
    setDefaultLandingPage: mockSetDefaultLandingPage,
    setSidebarDensity: mockSetSidebarDensity,
    setNotifyOnRunComplete: mock(),
    setNotifyOnRunFailed: mock(),
    setNotifyOnScheduleTriggered: mock(),
  };
  const useUserPreferencesStore = ((selector?: any) => {
    const state = {
      ..._state,
      defaultLandingPage: mockDefaultLandingPage,
      sidebarDensity: mockSidebarDensity,
    };
    return selector ? selector(state) : state;
  }) as any;
  useUserPreferencesStore.setState = (partial: any) => {
    const next = typeof partial === 'function' ? partial(_state) : partial;
    Object.assign(_state, next);
    if (next && 'defaultLandingPage' in next) mockDefaultLandingPage = next.defaultLandingPage;
    if (next && 'sidebarDensity' in next) mockSidebarDensity = next.sidebarDensity;
  };
  useUserPreferencesStore.getState = () => ({
    ..._state,
    defaultLandingPage: mockDefaultLandingPage,
    sidebarDensity: mockSidebarDensity,
  });
  useUserPreferencesStore.subscribe = () => () => {};
  useUserPreferencesStore.destroy = () => {};
  return { useUserPreferencesStore };
});

import { GeneralSettings } from '../GeneralSettings';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetMocks() {
  mockDefaultLandingPage = '/';
  mockSidebarDensity = 'comfortable';
  mockSetDefaultLandingPage.mockClear();
  mockSetSidebarDensity.mockClear();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GeneralSettings', () => {
  beforeEach(() => {
    cleanup();
    resetMocks();
  });

  afterEach(cleanup);

  it('renders Default Landing Page label and description', () => {
    render(<GeneralSettings />);

    expect(screen.getByText('Default Landing Page')).toBeTruthy();
    expect(screen.getByText('Choose which page loads when you sign in.')).toBeTruthy();
  });

  it('renders Sidebar Density label and description', () => {
    render(<GeneralSettings />);

    expect(screen.getByText('Sidebar Density')).toBeTruthy();
    expect(screen.getByText('Control the sidebar layout density.')).toBeTruthy();
  });

  it('renders Comfortable and Compact density options', () => {
    render(<GeneralSettings />);

    expect(screen.getByText('Comfortable')).toBeTruthy();
    expect(screen.getByText('Compact')).toBeTruthy();
  });

  it('marks Comfortable as pressed when sidebarDensity is comfortable', () => {
    mockSidebarDensity = 'comfortable';
    render(<GeneralSettings />);

    const comfortableButton = screen.getByText('Comfortable').closest('button')!;
    expect(comfortableButton.getAttribute('aria-pressed')).toBe('true');
  });

  it('marks Compact as pressed when sidebarDensity is compact', () => {
    mockSidebarDensity = 'compact';
    render(<GeneralSettings />);

    const compactButton = screen.getByText('Compact').closest('button')!;
    expect(compactButton.getAttribute('aria-pressed')).toBe('true');
  });

  it('calls setSidebarDensity when Compact is clicked', () => {
    mockSidebarDensity = 'comfortable';
    render(<GeneralSettings />);

    const compactButton = screen.getByText('Compact').closest('button')!;
    fireEvent.click(compactButton);

    expect(mockSetSidebarDensity).toHaveBeenCalledWith('compact');
  });

  it('calls setSidebarDensity when Comfortable is clicked', () => {
    mockSidebarDensity = 'compact';
    render(<GeneralSettings />);

    const comfortableButton = screen.getByText('Comfortable').closest('button')!;
    fireEvent.click(comfortableButton);

    expect(mockSetSidebarDensity).toHaveBeenCalledWith('comfortable');
  });

  it('renders the landing page select trigger', () => {
    render(<GeneralSettings />);

    const trigger = screen.getByRole('combobox', { name: /default landing page/i });
    expect(trigger).toBeTruthy();
  });
});
