import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type WorkflowMode = 'design' | 'execution';

/** A terminal tab docked in the bottom panel. */
export interface DockedTerminal {
  nodeId: string;
  label: string;
  runId?: string;
  status: 'idle' | 'running' | 'completed' | 'failed';
}

interface WorkflowUiState {
  mode: WorkflowMode;
  inspectorTab: 'events' | 'logs' | 'artifacts' | 'agent' | 'io' | 'network';
  libraryOpen: boolean;
  inspectorWidth: number;
  showDemoComponents: boolean;
  configPanelOpen: boolean;
  schedulesPanelOpen: boolean;
  versionHistoryPanelOpen: boolean;
  humanInputRequestId: string | null;
  humanInputDialogOpen: boolean;
  /** Terminal tabs docked in the bottom panel. */
  dockedTerminals: DockedTerminal[];
  /** Currently active (visible) terminal tab's node ID. */
  activeDockedTerminalId: string | null;
  /** Height of the terminal dock panel in px (persisted). */
  terminalPanelHeight: number;
  /** Whether the dock panel is collapsed to tab bar only. */
  terminalPanelCollapsed: boolean;
  /** Whether the edge heat map overlay is enabled (execution mode only). */
  showHeatMap: boolean;
  /** Whether smart edge routing (orthogonal node-avoidance) is enabled. */
  smartRouting: boolean;
  /** Whether visual edge bundling (fan-out trunk indicators) is enabled (design mode only). */
  edgeBundling: boolean;
}

interface WorkflowUiActions {
  setMode: (mode: WorkflowMode) => void;
  setInspectorTab: (tab: WorkflowUiState['inspectorTab']) => void;
  setLibraryOpen: (open: boolean) => void;
  toggleLibrary: () => void;
  setInspectorWidth: (width: number) => void;
  toggleDemoComponents: () => void;
  setConfigPanelOpen: (open: boolean) => void;
  setSchedulesPanelOpen: (open: boolean) => void;
  setVersionHistoryPanelOpen: (open: boolean) => void;
  openHumanInputDialog: (requestId: string) => void;
  closeHumanInputDialog: () => void;
  /** Add a terminal to the dock panel. If already present, activates it. */
  dockTerminal: (nodeId: string, label: string, runId?: string) => void;
  /** Remove a terminal tab from the dock panel. */
  undockTerminal: (nodeId: string) => void;
  /** Set the active (visible) terminal tab. */
  setActiveDockedTerminal: (nodeId: string) => void;
  /** Set dock panel height (clamped 150 … 70% viewport). */
  setTerminalPanelHeight: (height: number) => void;
  /** Toggle collapsed/expanded state of the dock panel. */
  toggleTerminalPanelCollapsed: () => void;
  /** Remove all terminal tabs and hide the dock panel. */
  clearDockedTerminals: () => void;
  /** Toggle the edge heat map overlay on/off. */
  toggleHeatMap: () => void;
  /** Toggle smart edge routing on/off. */
  toggleSmartRouting: () => void;
  /** Toggle visual edge bundling on/off. */
  toggleEdgeBundling: () => void;
}

export const useWorkflowUiStore = create<WorkflowUiState & WorkflowUiActions>()(
  persist(
    (set) => ({
      mode: 'design',
      inspectorTab: 'events',
      libraryOpen: true,
      inspectorWidth: 432,
      dockedTerminals: [],
      activeDockedTerminalId: null,
      terminalPanelHeight: 300,
      terminalPanelCollapsed: false,
      showHeatMap: false,
      smartRouting: false,
      edgeBundling: false,
      setMode: (mode) =>
        set((state) => ({
          mode,
          inspectorTab: mode === 'execution' ? (state.inspectorTab ?? 'events') : 'events',
          // Don't auto-open library on mode switch - keep current state or close if going to execution
          libraryOpen: mode === 'execution' ? false : state.libraryOpen,
        })),
      setInspectorTab: (tab) => set({ inspectorTab: tab }),
      setLibraryOpen: (open) => set({ libraryOpen: open }),
      toggleLibrary: () => set((state) => ({ libraryOpen: !state.libraryOpen })),
      setInspectorWidth: (width) =>
        set(() => ({
          inspectorWidth: Math.max(320, Math.min(720, Math.round(width))),
        })),
      showDemoComponents: false,
      toggleDemoComponents: () =>
        set((state) => ({ showDemoComponents: !state.showDemoComponents })),
      configPanelOpen: false,
      schedulesPanelOpen: false,
      versionHistoryPanelOpen: false,
      humanInputRequestId: null,
      humanInputDialogOpen: false,
      setConfigPanelOpen: (open) => set({ configPanelOpen: open }),
      setSchedulesPanelOpen: (open) => set({ schedulesPanelOpen: open }),
      setVersionHistoryPanelOpen: (open) => set({ versionHistoryPanelOpen: open }),
      openHumanInputDialog: (requestId) =>
        set({ humanInputDialogOpen: true, humanInputRequestId: requestId }),
      closeHumanInputDialog: () => set({ humanInputDialogOpen: false, humanInputRequestId: null }),

      // --- Terminal dock actions ---
      dockTerminal: (nodeId, label, runId) =>
        set((state) => {
          const exists = state.dockedTerminals.some((t) => t.nodeId === nodeId);
          if (exists) {
            return {
              activeDockedTerminalId: nodeId,
              terminalPanelCollapsed: false,
            };
          }
          return {
            dockedTerminals: [
              ...state.dockedTerminals,
              { nodeId, label, runId, status: 'idle' as const },
            ],
            activeDockedTerminalId: nodeId,
            terminalPanelCollapsed: false,
          };
        }),

      undockTerminal: (nodeId) =>
        set((state) => {
          const remaining = state.dockedTerminals.filter((t) => t.nodeId !== nodeId);
          const wasActive = state.activeDockedTerminalId === nodeId;
          return {
            dockedTerminals: remaining,
            activeDockedTerminalId: wasActive
              ? remaining.length > 0
                ? remaining[remaining.length - 1].nodeId
                : null
              : state.activeDockedTerminalId,
          };
        }),

      setActiveDockedTerminal: (nodeId) =>
        set({ activeDockedTerminalId: nodeId, terminalPanelCollapsed: false }),

      setTerminalPanelHeight: (height) =>
        set(() => {
          const maxHeight = typeof window !== 'undefined' ? window.innerHeight * 0.7 : 600;
          return {
            terminalPanelHeight: Math.max(150, Math.min(maxHeight, Math.round(height))),
          };
        }),

      toggleTerminalPanelCollapsed: () =>
        set((state) => ({ terminalPanelCollapsed: !state.terminalPanelCollapsed })),

      clearDockedTerminals: () => set({ dockedTerminals: [], activeDockedTerminalId: null }),

      toggleHeatMap: () => set((state) => ({ showHeatMap: !state.showHeatMap })),

      toggleSmartRouting: () => set((state) => ({ smartRouting: !state.smartRouting })),

      toggleEdgeBundling: () => set((state) => ({ edgeBundling: !state.edgeBundling })),
    }),
    {
      name: 'workflow-ui-preferences',
      partialize: (state) => ({
        // Note: 'mode' is intentionally NOT persisted - workflows should always open in design mode
        libraryOpen: state.libraryOpen,
        inspectorWidth: state.inspectorWidth,
        terminalPanelHeight: state.terminalPanelHeight,
        showHeatMap: state.showHeatMap,
        smartRouting: state.smartRouting,
        edgeBundling: state.edgeBundling,
      }),
      // Merge function to ensure mode is never restored from localStorage
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...(persistedState as Partial<WorkflowUiState>),
        // Always use default mode, never restore from localStorage
        mode: 'design' as WorkflowMode,
      }),
    },
  ),
);
