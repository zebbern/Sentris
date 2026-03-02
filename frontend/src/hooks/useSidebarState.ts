import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useSwipeGesture } from '@/hooks/useSwipeGesture';

const SIDEBAR_COLLAPSED_KEY = 'sentris:sidebar-collapsed';

interface UseSidebarStateOptions {
  isMobile: boolean;
  isTablet: boolean;
  /** Settings items for auto-expand logic */
  settingsHrefs: string[];
}

interface SidebarState {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  wasExplicitlyOpened: boolean;
  setWasExplicitlyOpened: (opened: boolean) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  handleToggle: () => void;
  handleMouseEnter: () => void;
  handleMouseLeave: () => void;
  handleBackdropClick: () => void;
  /** Close sidebar (mobile) and clear explicit flag */
  closeMobileSidebar: () => void;
}

/**
 * Manages sidebar open/close state, hover expand/collapse,
 * auto-collapse on route change, window blur collapse, and mobile swipe gestures.
 */
export function useSidebarState({
  isMobile,
  isTablet,
  settingsHrefs,
}: UseSidebarStateOptions): SidebarState {
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (isMobile || isTablet) return false;
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) !== 'true';
    } catch {
      return true;
    }
  });
  const [wasExplicitlyOpened, setWasExplicitlyOpened] = useState(() => {
    if (isMobile || isTablet) return false;
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) !== 'true';
    } catch {
      return true;
    }
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const location = useLocation();

  // Auto-collapse sidebar when opening workflow builder, expand for other routes
  useEffect(() => {
    if (isMobile || isTablet) {
      setSidebarOpen(false);
      setWasExplicitlyOpened(false);
    } else {
      const isWorkflowRoute =
        (location.pathname.startsWith('/workflows') ||
          location.pathname.startsWith('/webhooks/')) &&
        location.pathname !== '/';
      if (isWorkflowRoute) {
        setSidebarOpen(false);
        setWasExplicitlyOpened(false);
      } else {
        // Respect persisted user preference for non-workflow routes
        let preferOpen = true;
        try {
          preferOpen = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) !== 'true';
        } catch {
          // Ignore localStorage errors
        }
        setSidebarOpen(preferOpen);
        setWasExplicitlyOpened(preferOpen);
      }
    }
  }, [location.pathname, isMobile, isTablet]);

  // Auto-expand the Manage section when navigating to a settings sub-page
  useEffect(() => {
    const isSettingsPage =
      settingsHrefs.some(
        (href) => location.pathname === href || location.pathname.startsWith(href + '/'),
      ) || location.pathname.startsWith('/settings');
    if (isSettingsPage && !settingsOpen) {
      setSettingsOpen(true);
    }
  }, [location.pathname, settingsOpen, settingsHrefs]);

  // Handle hover to expand sidebar when collapsed (desktop only)
  const handleMouseEnter = useCallback(() => {
    if (isMobile) return;
    if (!sidebarOpen) {
      setSidebarOpen(true);
    }
  }, [isMobile, sidebarOpen]);

  const handleMouseLeave = useCallback(() => {
    if (isMobile) return;
    if (!wasExplicitlyOpened && sidebarOpen) {
      setSidebarOpen(false);
    }
  }, [isMobile, wasExplicitlyOpened, sidebarOpen]);

  // Close sidebar when window loses focus
  useEffect(() => {
    const handleWindowBlur = () => {
      if (!isMobile && !wasExplicitlyOpened && sidebarOpen) {
        setSidebarOpen(false);
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden && !isMobile && !wasExplicitlyOpened && sidebarOpen) {
        setSidebarOpen(false);
      }
    };

    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isMobile, wasExplicitlyOpened, sidebarOpen]);

  const handleToggle = useCallback(() => {
    const newState = !sidebarOpen;
    setSidebarOpen(newState);
    setWasExplicitlyOpened(newState);
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(!newState));
    } catch {
      // Ignore localStorage errors (e.g., storage full, disabled)
    }
  }, [sidebarOpen]);

  // Close sidebar when clicking backdrop on mobile
  const handleBackdropClick = useCallback(() => {
    if (isMobile && sidebarOpen) {
      setSidebarOpen(false);
      setWasExplicitlyOpened(false);
    }
  }, [isMobile, sidebarOpen]);

  const closeMobileSidebar = useCallback(() => {
    setSidebarOpen(false);
    setWasExplicitlyOpened(false);
  }, []);

  // Mobile swipe gesture
  useSwipeGesture({
    enabled: isMobile,
    isOpen: sidebarOpen,
    onOpen: () => {
      setSidebarOpen(true);
      setWasExplicitlyOpened(true);
    },
    onClose: () => {
      setSidebarOpen(false);
      setWasExplicitlyOpened(false);
    },
  });

  return {
    sidebarOpen,
    setSidebarOpen,
    wasExplicitlyOpened,
    setWasExplicitlyOpened,
    settingsOpen,
    setSettingsOpen,
    handleToggle,
    handleMouseEnter,
    handleMouseLeave,
    handleBackdropClick,
    closeMobileSidebar,
  };
}
