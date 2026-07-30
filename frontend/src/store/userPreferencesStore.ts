import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type SidebarDensity = 'compact' | 'comfortable';

interface UserPreferencesState {
  defaultLandingPage: string;
  sidebarDensity: SidebarDensity;
  notifyOnRunComplete: boolean;
  notifyOnRunFailed: boolean;
  notifyOnScheduleTriggered: boolean;
  showCanvasMinimap: boolean;
  /** When true, config panel hides read-only info sections (docs, outputs, etc.). */
  hideConfigInfoSections: boolean;
  /** When true, workflow designer schedules summary collapses to a corner chip. */
  schedulesSummaryCollapsed: boolean;
  setDefaultLandingPage: (page: string) => void;
  setSidebarDensity: (density: SidebarDensity) => void;
  setNotifyOnRunComplete: (value: boolean) => void;
  setNotifyOnRunFailed: (value: boolean) => void;
  setNotifyOnScheduleTriggered: (value: boolean) => void;
  setShowCanvasMinimap: (value: boolean) => void;
  setHideConfigInfoSections: (value: boolean) => void;
  setSchedulesSummaryCollapsed: (value: boolean) => void;
}

export const useUserPreferencesStore = create<UserPreferencesState>()(
  persist(
    (set) => ({
      defaultLandingPage: '/',
      sidebarDensity: 'comfortable',
      notifyOnRunComplete: true,
      notifyOnRunFailed: true,
      notifyOnScheduleTriggered: true,
      showCanvasMinimap: false,
      hideConfigInfoSections: true,
      schedulesSummaryCollapsed: false,
      setDefaultLandingPage: (page) => set({ defaultLandingPage: page }),
      setSidebarDensity: (density) => set({ sidebarDensity: density }),
      setNotifyOnRunComplete: (value) => set({ notifyOnRunComplete: value }),
      setNotifyOnRunFailed: (value) => set({ notifyOnRunFailed: value }),
      setNotifyOnScheduleTriggered: (value) => set({ notifyOnScheduleTriggered: value }),
      setShowCanvasMinimap: (value) => set({ showCanvasMinimap: value }),
      setHideConfigInfoSections: (value) => set({ hideConfigInfoSections: value }),
      setSchedulesSummaryCollapsed: (value) => set({ schedulesSummaryCollapsed: value }),
    }),
    {
      name: 'sentris:user-preferences',
      partialize: (state) => ({
        defaultLandingPage: state.defaultLandingPage,
        sidebarDensity: state.sidebarDensity,
        notifyOnRunComplete: state.notifyOnRunComplete,
        notifyOnRunFailed: state.notifyOnRunFailed,
        notifyOnScheduleTriggered: state.notifyOnScheduleTriggered,
        showCanvasMinimap: state.showCanvasMinimap,
        hideConfigInfoSections: state.hideConfigInfoSections,
        schedulesSummaryCollapsed: state.schedulesSummaryCollapsed,
      }),
    },
  ),
);
