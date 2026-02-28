import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type SidebarDensity = 'compact' | 'comfortable';

interface UserPreferencesState {
  defaultLandingPage: string;
  sidebarDensity: SidebarDensity;
  setDefaultLandingPage: (page: string) => void;
  setSidebarDensity: (density: SidebarDensity) => void;
}

export const useUserPreferencesStore = create<UserPreferencesState>()(
  persist(
    (set) => ({
      defaultLandingPage: '/',
      sidebarDensity: 'comfortable',
      setDefaultLandingPage: (page) => set({ defaultLandingPage: page }),
      setSidebarDensity: (density) => set({ sidebarDensity: density }),
    }),
    {
      name: 'shipsec:user-preferences',
      partialize: (state) => ({
        defaultLandingPage: state.defaultLandingPage,
        sidebarDensity: state.sidebarDensity,
      }),
    },
  ),
);
