import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type SidebarDensity = 'compact' | 'comfortable';

interface UserPreferencesState {
  defaultLandingPage: string;
  sidebarDensity: SidebarDensity;
  notifyOnRunComplete: boolean;
  notifyOnRunFailed: boolean;
  notifyOnScheduleTriggered: boolean;
  setDefaultLandingPage: (page: string) => void;
  setSidebarDensity: (density: SidebarDensity) => void;
  setNotifyOnRunComplete: (value: boolean) => void;
  setNotifyOnRunFailed: (value: boolean) => void;
  setNotifyOnScheduleTriggered: (value: boolean) => void;
}

export const useUserPreferencesStore = create<UserPreferencesState>()(
  persist(
    (set) => ({
      defaultLandingPage: '/',
      sidebarDensity: 'comfortable',
      notifyOnRunComplete: true,
      notifyOnRunFailed: true,
      notifyOnScheduleTriggered: true,
      setDefaultLandingPage: (page) => set({ defaultLandingPage: page }),
      setSidebarDensity: (density) => set({ sidebarDensity: density }),
      setNotifyOnRunComplete: (value) => set({ notifyOnRunComplete: value }),
      setNotifyOnRunFailed: (value) => set({ notifyOnRunFailed: value }),
      setNotifyOnScheduleTriggered: (value) => set({ notifyOnScheduleTriggered: value }),
    }),
    {
      name: 'sentris:user-preferences',
      partialize: (state) => ({
        defaultLandingPage: state.defaultLandingPage,
        sidebarDensity: state.sidebarDensity,
        notifyOnRunComplete: state.notifyOnRunComplete,
        notifyOnRunFailed: state.notifyOnRunFailed,
        notifyOnScheduleTriggered: state.notifyOnScheduleTriggered,
      }),
    },
  ),
);
