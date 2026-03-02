import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { useWorkflowUiStore } from '../workflowUiStore';

// Save original window.innerHeight
const originalInnerHeight = window.innerHeight;

describe('workflowUiStore', () => {
  beforeEach(() => {
    useWorkflowUiStore.setState({
      mode: 'design',
      inspectorTab: 'events',
      libraryOpen: true,
      inspectorWidth: 432,
      showDemoComponents: false,
      configPanelOpen: false,
      schedulesPanelOpen: false,
      versionHistoryPanelOpen: false,
      humanInputRequestId: null,
      humanInputDialogOpen: false,
      dockedTerminals: [],
      activeDockedTerminalId: null,
      terminalPanelHeight: 300,
      terminalPanelCollapsed: false,
      showHeatMap: false,
      smartRouting: false,
      edgeBundling: false,
    });
    localStorage.clear();
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerHeight', { value: originalInnerHeight, writable: true });
  });

  // --- Initial state ---

  it('has correct initial state', () => {
    const state = useWorkflowUiStore.getState();
    expect(state.mode).toBe('design');
    expect(state.libraryOpen).toBe(true);
    expect(state.inspectorTab).toBe('events');
    expect(state.inspectorWidth).toBe(432);
    expect(state.dockedTerminals).toEqual([]);
    expect(state.activeDockedTerminalId).toBeNull();
    expect(state.terminalPanelHeight).toBe(300);
    expect(state.terminalPanelCollapsed).toBe(false);
    expect(state.showHeatMap).toBe(false);
    expect(state.smartRouting).toBe(false);
    expect(state.edgeBundling).toBe(false);
  });

  // --- setMode ---

  it('setMode("execution") switches mode and closes the library panel', () => {
    useWorkflowUiStore.getState().setMode('execution');

    const state = useWorkflowUiStore.getState();
    expect(state.mode).toBe('execution');
    expect(state.libraryOpen).toBe(false);
  });

  it('setMode("design") switches mode and preserves current library state', () => {
    // Close library first
    useWorkflowUiStore.setState({ libraryOpen: false });
    useWorkflowUiStore.getState().setMode('design');

    const state = useWorkflowUiStore.getState();
    expect(state.mode).toBe('design');
    expect(state.libraryOpen).toBe(false); // preserved as false
  });

  it('setMode("design") preserves libraryOpen when it is true', () => {
    expect(useWorkflowUiStore.getState().libraryOpen).toBe(true);
    useWorkflowUiStore.getState().setMode('design');
    expect(useWorkflowUiStore.getState().libraryOpen).toBe(true);
  });

  it('setMode("execution") resets inspectorTab to events', () => {
    useWorkflowUiStore.setState({ inspectorTab: 'logs' });
    useWorkflowUiStore.getState().setMode('execution');
    expect(useWorkflowUiStore.getState().inspectorTab).toBe('logs'); // preserves current tab
  });

  // --- setInspectorWidth ---

  it('setInspectorWidth() clamps to min 320', () => {
    useWorkflowUiStore.getState().setInspectorWidth(100);
    expect(useWorkflowUiStore.getState().inspectorWidth).toBe(320);
  });

  it('setInspectorWidth() clamps to max 720', () => {
    useWorkflowUiStore.getState().setInspectorWidth(1000);
    expect(useWorkflowUiStore.getState().inspectorWidth).toBe(720);
  });

  it('setInspectorWidth() accepts valid values within range', () => {
    useWorkflowUiStore.getState().setInspectorWidth(500);
    expect(useWorkflowUiStore.getState().inspectorWidth).toBe(500);
  });

  it('setInspectorWidth() rounds to integer', () => {
    useWorkflowUiStore.getState().setInspectorWidth(450.7);
    expect(useWorkflowUiStore.getState().inspectorWidth).toBe(451);
  });

  // --- toggleLibrary ---

  it('toggleLibrary() toggles libraryOpen from true to false', () => {
    expect(useWorkflowUiStore.getState().libraryOpen).toBe(true);
    useWorkflowUiStore.getState().toggleLibrary();
    expect(useWorkflowUiStore.getState().libraryOpen).toBe(false);
  });

  it('toggleLibrary() toggles libraryOpen from false to true', () => {
    useWorkflowUiStore.setState({ libraryOpen: false });
    useWorkflowUiStore.getState().toggleLibrary();
    expect(useWorkflowUiStore.getState().libraryOpen).toBe(true);
  });

  // --- dockTerminal ---

  it('dockTerminal() adds a terminal tab and sets it as active', () => {
    useWorkflowUiStore.getState().dockTerminal('node-1', 'Scanner');

    const state = useWorkflowUiStore.getState();
    expect(state.dockedTerminals).toHaveLength(1);
    expect(state.dockedTerminals[0]).toEqual({
      nodeId: 'node-1',
      label: 'Scanner',
      runId: undefined,
      status: 'idle',
    });
    expect(state.activeDockedTerminalId).toBe('node-1');
    expect(state.terminalPanelCollapsed).toBe(false);
  });

  it('dockTerminal() with runId includes it in the terminal tab', () => {
    useWorkflowUiStore.getState().dockTerminal('node-1', 'Scanner', 'run-42');

    const state = useWorkflowUiStore.getState();
    expect(state.dockedTerminals[0].runId).toBe('run-42');
  });

  it('dockTerminal() for already-docked nodeId activates it without duplicating', () => {
    useWorkflowUiStore.getState().dockTerminal('node-1', 'Scanner');
    useWorkflowUiStore.getState().dockTerminal('node-2', 'Analyzer');
    // Dock node-1 again
    useWorkflowUiStore.getState().dockTerminal('node-1', 'Scanner');

    const state = useWorkflowUiStore.getState();
    expect(state.dockedTerminals).toHaveLength(2); // no duplicate
    expect(state.activeDockedTerminalId).toBe('node-1'); // switched back
  });

  it('dockTerminal() uncollapses the panel', () => {
    useWorkflowUiStore.setState({ terminalPanelCollapsed: true });
    useWorkflowUiStore.getState().dockTerminal('node-1', 'Scanner');
    expect(useWorkflowUiStore.getState().terminalPanelCollapsed).toBe(false);
  });

  // --- undockTerminal ---

  it('undockTerminal() removes the tab and activates the last remaining', () => {
    useWorkflowUiStore.getState().dockTerminal('node-1', 'Scanner');
    useWorkflowUiStore.getState().dockTerminal('node-2', 'Analyzer');
    useWorkflowUiStore.getState().dockTerminal('node-3', 'Reporter');

    // Undock the active one (node-3)
    useWorkflowUiStore.getState().undockTerminal('node-3');

    const state = useWorkflowUiStore.getState();
    expect(state.dockedTerminals).toHaveLength(2);
    expect(state.activeDockedTerminalId).toBe('node-2'); // last remaining
  });

  it('undockTerminal() of a non-active tab preserves active terminal', () => {
    useWorkflowUiStore.getState().dockTerminal('node-1', 'Scanner');
    useWorkflowUiStore.getState().dockTerminal('node-2', 'Analyzer');

    // Undock non-active node-1
    useWorkflowUiStore.getState().undockTerminal('node-1');

    const state = useWorkflowUiStore.getState();
    expect(state.dockedTerminals).toHaveLength(1);
    expect(state.activeDockedTerminalId).toBe('node-2'); // unchanged
  });

  it('undockTerminal() of the last tab sets activeDockedTerminalId to null', () => {
    useWorkflowUiStore.getState().dockTerminal('node-1', 'Scanner');
    useWorkflowUiStore.getState().undockTerminal('node-1');

    const state = useWorkflowUiStore.getState();
    expect(state.dockedTerminals).toEqual([]);
    expect(state.activeDockedTerminalId).toBeNull();
  });

  // --- setTerminalPanelHeight ---

  it('setTerminalPanelHeight() clamps to minimum 150', () => {
    useWorkflowUiStore.getState().setTerminalPanelHeight(50);
    expect(useWorkflowUiStore.getState().terminalPanelHeight).toBe(150);
  });

  it('setTerminalPanelHeight() clamps to 70% of window height', () => {
    Object.defineProperty(window, 'innerHeight', { value: 1000, writable: true });
    useWorkflowUiStore.getState().setTerminalPanelHeight(900);
    expect(useWorkflowUiStore.getState().terminalPanelHeight).toBe(700); // 70% of 1000
  });

  it('setTerminalPanelHeight() accepts valid values', () => {
    Object.defineProperty(window, 'innerHeight', { value: 1000, writable: true });
    useWorkflowUiStore.getState().setTerminalPanelHeight(400);
    expect(useWorkflowUiStore.getState().terminalPanelHeight).toBe(400);
  });

  it('setTerminalPanelHeight() rounds to integer', () => {
    Object.defineProperty(window, 'innerHeight', { value: 1000, writable: true });
    useWorkflowUiStore.getState().setTerminalPanelHeight(350.6);
    expect(useWorkflowUiStore.getState().terminalPanelHeight).toBe(351);
  });

  // --- toggleTerminalPanelCollapsed ---

  it('toggleTerminalPanelCollapsed() toggles from false to true', () => {
    useWorkflowUiStore.getState().toggleTerminalPanelCollapsed();
    expect(useWorkflowUiStore.getState().terminalPanelCollapsed).toBe(true);
  });

  it('toggleTerminalPanelCollapsed() toggles from true to false', () => {
    useWorkflowUiStore.setState({ terminalPanelCollapsed: true });
    useWorkflowUiStore.getState().toggleTerminalPanelCollapsed();
    expect(useWorkflowUiStore.getState().terminalPanelCollapsed).toBe(false);
  });

  // --- clearDockedTerminals ---

  it('clearDockedTerminals() removes all tabs and nulls the active terminal', () => {
    useWorkflowUiStore.getState().dockTerminal('node-1', 'Scanner');
    useWorkflowUiStore.getState().dockTerminal('node-2', 'Analyzer');

    useWorkflowUiStore.getState().clearDockedTerminals();

    const state = useWorkflowUiStore.getState();
    expect(state.dockedTerminals).toEqual([]);
    expect(state.activeDockedTerminalId).toBeNull();
  });

  // --- Toggle booleans ---

  it('toggleHeatMap() toggles showHeatMap', () => {
    expect(useWorkflowUiStore.getState().showHeatMap).toBe(false);
    useWorkflowUiStore.getState().toggleHeatMap();
    expect(useWorkflowUiStore.getState().showHeatMap).toBe(true);
    useWorkflowUiStore.getState().toggleHeatMap();
    expect(useWorkflowUiStore.getState().showHeatMap).toBe(false);
  });

  it('toggleSmartRouting() toggles smartRouting', () => {
    expect(useWorkflowUiStore.getState().smartRouting).toBe(false);
    useWorkflowUiStore.getState().toggleSmartRouting();
    expect(useWorkflowUiStore.getState().smartRouting).toBe(true);
    useWorkflowUiStore.getState().toggleSmartRouting();
    expect(useWorkflowUiStore.getState().smartRouting).toBe(false);
  });

  it('toggleEdgeBundling() toggles edgeBundling', () => {
    expect(useWorkflowUiStore.getState().edgeBundling).toBe(false);
    useWorkflowUiStore.getState().toggleEdgeBundling();
    expect(useWorkflowUiStore.getState().edgeBundling).toBe(true);
    useWorkflowUiStore.getState().toggleEdgeBundling();
    expect(useWorkflowUiStore.getState().edgeBundling).toBe(false);
  });
});
