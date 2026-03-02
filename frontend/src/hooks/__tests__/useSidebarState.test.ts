import { describe, it, expect, afterEach, beforeEach, mock } from 'bun:test';
import { renderHook, act, cleanup } from '@testing-library/react';

// Mock react-router-dom
const mockLocation = { pathname: '/' };
mock.module('react-router-dom', () => ({
  useLocation: () => mockLocation,
}));

// Mock useSwipeGesture (side-effect only hook)
mock.module('@/hooks/useSwipeGesture', () => ({
  useSwipeGesture: mock(),
}));

import { useSidebarState } from '../useSidebarState';

afterEach(cleanup);

describe('useSidebarState', () => {
  let originalGetItem: typeof Storage.prototype.getItem;
  let originalSetItem: typeof Storage.prototype.setItem;

  beforeEach(() => {
    mockLocation.pathname = '/';
    originalGetItem = Storage.prototype.getItem;
    originalSetItem = Storage.prototype.setItem;
    Storage.prototype.getItem = mock().mockReturnValue(null);
    Storage.prototype.setItem = mock();
  });

  afterEach(() => {
    Storage.prototype.getItem = originalGetItem;
    Storage.prototype.setItem = originalSetItem;
  });

  const defaultOptions = {
    isMobile: false,
    isTablet: false,
    settingsHrefs: ['/settings/general', '/settings/security'],
  };

  it('returns initial sidebar state as open on desktop when no stored preference', () => {
    const { result } = renderHook(() => useSidebarState(defaultOptions));
    expect(result.current.sidebarOpen).toBe(true);
  });

  it('starts collapsed when stored preference is collapsed', () => {
    (Storage.prototype.getItem as ReturnType<typeof mock>).mockReturnValue('true');
    const { result } = renderHook(() => useSidebarState(defaultOptions));
    expect(result.current.sidebarOpen).toBe(false);
  });

  it('starts closed on mobile', () => {
    const { result } = renderHook(() => useSidebarState({ ...defaultOptions, isMobile: true }));
    expect(result.current.sidebarOpen).toBe(false);
  });

  it('starts closed on tablet', () => {
    const { result } = renderHook(() => useSidebarState({ ...defaultOptions, isTablet: true }));
    expect(result.current.sidebarOpen).toBe(false);
  });

  it('handleToggle switches sidebar state', () => {
    const { result } = renderHook(() => useSidebarState(defaultOptions));

    act(() => result.current.handleToggle());
    expect(result.current.sidebarOpen).toBe(false);

    act(() => result.current.handleToggle());
    expect(result.current.sidebarOpen).toBe(true);
  });

  it('handleToggle persists preference to localStorage', () => {
    const { result } = renderHook(() => useSidebarState(defaultOptions));

    act(() => result.current.handleToggle());

    expect(Storage.prototype.setItem).toHaveBeenCalledWith('sentris:sidebar-collapsed', 'true');
  });

  it('handleBackdropClick closes the sidebar on mobile', () => {
    const { result } = renderHook(() => useSidebarState({ ...defaultOptions, isMobile: true }));

    // Open sidebar first
    act(() => result.current.setSidebarOpen(true));

    act(() => result.current.handleBackdropClick());
    expect(result.current.sidebarOpen).toBe(false);
  });

  it('closeMobileSidebar closes sidebar and clears explicit flag', () => {
    const { result } = renderHook(() => useSidebarState({ ...defaultOptions, isMobile: true }));

    act(() => {
      result.current.setSidebarOpen(true);
      result.current.setWasExplicitlyOpened(true);
    });

    act(() => result.current.closeMobileSidebar());

    expect(result.current.sidebarOpen).toBe(false);
    expect(result.current.wasExplicitlyOpened).toBe(false);
  });

  it('handleMouseEnter opens sidebar when collapsed on desktop', () => {
    const { result } = renderHook(() => useSidebarState(defaultOptions));

    // Collapse it first
    act(() => result.current.handleToggle());
    expect(result.current.sidebarOpen).toBe(false);

    act(() => result.current.handleMouseEnter());
    expect(result.current.sidebarOpen).toBe(true);
  });

  it('handleMouseLeave closes sidebar if not explicitly opened', () => {
    const { result } = renderHook(() => useSidebarState(defaultOptions));

    // Collapse, then hover-open
    act(() => result.current.handleToggle());
    act(() => result.current.handleMouseEnter());
    expect(result.current.sidebarOpen).toBe(true);

    act(() => result.current.handleMouseLeave());
    expect(result.current.sidebarOpen).toBe(false);
  });
});
