import { describe, it, beforeEach, afterEach, expect, mock, afterAll } from 'bun:test';
import { restoreMockedModules } from '@/test/restore-mocks';
import { screen, cleanup } from '@testing-library/react';
import { renderWithProviders } from '@/test/render-with-providers';
import * as reactRouterDom from 'react-router-dom';

// --- Mutable mock state ---
const mockRouteState = {
  params: { id: 'wf-123' as string, runId: undefined as string | undefined },
  pathname: '/workflows/wf-123',
};
const mockNavigate = mock();
const mockWorkflowStore: Record<string, unknown> = {
  metadata: { id: 'wf-123', name: 'Test Workflow', currentVersionId: 'v1' },
  isDirty: false,
  setMetadata: mock(),
  setWorkflowId: mock(),
  markClean: mock(),
  markDirty: mock(),
  resetWorkflow: mock(),
};
const mockUiStore: Record<string, unknown> = {
  mode: 'design',
  libraryOpen: false,
  toggleLibrary: mock(),
  inspectorWidth: 400,
  setInspectorWidth: mock(),
  setMode: mock(),
  showDemoComponents: false,
  toggleDemoComponents: mock(),
  configPanelOpen: false,
  schedulesPanelOpen: false,
  versionHistoryPanelOpen: false,
  setVersionHistoryPanelOpen: mock(),
  setLibraryOpen: mock(),
};
const mockTimelineStore: Record<string, unknown> = { selectedRunId: null };
const mockAuthStore: Record<string, unknown> = { roles: ['admin'] };
const mockLoaderState = { isLoading: false, setIsLoading: mock() };
const mockRunnerState = {
  runDialogOpen: false,
  setRunDialogOpen: mock(),
  runtimeInputs: [] as unknown[],
  prefilledRuntimeValues: {},
  pendingVersionId: null as string | null,
  handleRun: mock(),
  handleRerunFromTimeline: mock(),
  executeWorkflow: mock(),
};
const mockHistoryState = {
  undo: mock(),
  redo: mock(),
  canUndo: false,
  canRedo: false,
  captureSnapshot: mock(),
  initializeHistory: mock(),
};
const mockPersistenceState = {
  handleSave: mock(),
  setLastSavedGraphSignature: mock(),
  setLastSavedMetadata: mock(),
};
const mockLifecycleState = {
  mostRecentRunId: null as string | null,
  fetchRuns: mock(),
  resetHistoricalTracking: mock(),
};
const mockGraphControllers = {
  design: {
    nodes: [] as unknown[],
    edges: [] as unknown[],
    setNodes: mock(),
    setEdges: mock(),
    onNodesChange: mock(),
    onEdgesChange: mock(),
    nodesRef: { current: [] },
    edgesRef: { current: [] },
    preservedStateRef: { current: null },
    savedSnapshotRef: { current: null },
  },
  execution: {
    nodes: [] as unknown[],
    edges: [] as unknown[],
    setNodes: mock(),
    setEdges: mock(),
    onNodesChange: mock(),
    onEdgesChange: mock(),
    nodesRef: { current: [] },
    edgesRef: { current: [] },
    preservedStateRef: { current: null },
    savedSnapshotRef: { current: null },
  },
};
let capturedTopBarProps: Record<string, unknown> = {};

// --- Module mocks: infrastructure ---
mock.module('reactflow', () => ({
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="reactflow-provider">{children}</div>
  ),
}));
mock.module('react-router-dom', () => {
  return {
    ...reactRouterDom,
    useNavigate: () => mockNavigate,
    useParams: () => ({ ...mockRouteState.params }),
    useLocation: () => ({
      pathname: mockRouteState.pathname,
      search: '',
      hash: '',
      state: null,
      key: 'default',
    }),
  };
});
mock.module('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: mock() }) }));
mock.module('@/hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }));
mock.module('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
mock.module('@/utils/auth', () => ({ hasAdminRole: () => true }));
mock.module('@/hooks/queries/useRunQueries', () => ({ getRunByIdFromCache: () => null }));
mock.module('@/hooks/queries/useComponentQueries', () => ({
  useComponents: () => ({ data: { byId: {}, slugIndex: {} } }),
}));
mock.module('@/features/workflow-builder/workflowBuilderUtils', () => ({
  computeGraphSignature: () => 'mock-sig',
}));

// --- Module mocks: stores ---
mock.module('@/store/workflowStore', () => ({
  useWorkflowStore: (s: (state: Record<string, unknown>) => unknown) => s(mockWorkflowStore),
}));
mock.module('@/store/workflowUiStore', () => ({
  useWorkflowUiStore: (s: (state: Record<string, unknown>) => unknown) => s(mockUiStore),
}));
mock.module('@/store/executionTimelineStore', () => ({
  useExecutionTimelineStore: (s: (state: Record<string, unknown>) => unknown) =>
    s(mockTimelineStore),
}));
mock.module('@/store/authStore', () => ({
  useAuthStore: (s: (state: Record<string, unknown>) => unknown) => s(mockAuthStore),
}));

// --- Module mocks: hooks ---
mock.module('@/features/workflow-builder/hooks/useWorkflowGraphControllers', () => ({
  useWorkflowGraphControllers: () => mockGraphControllers,
}));
mock.module('@/features/workflow-builder/hooks/useWorkflowLoader', () => ({
  useWorkflowLoader: () => ({ ...mockLoaderState }),
}));
mock.module('@/features/workflow-builder/hooks/useWorkflowRunner', () => ({
  useWorkflowRunner: () => ({ ...mockRunnerState }),
}));
mock.module('@/features/workflow-builder/hooks/useWorkflowHistory', () => ({
  useWorkflowHistory: () => ({ ...mockHistoryState }),
}));
mock.module('@/features/workflow-builder/hooks/useDesignWorkflowPersistence', () => ({
  useDesignWorkflowPersistence: () => ({ ...mockPersistenceState }),
}));
mock.module('@/features/workflow-builder/hooks/useWorkflowExecutionLifecycle', () => ({
  useWorkflowExecutionLifecycle: () => ({ ...mockLifecycleState }),
}));
mock.module('@/features/workflow-builder/hooks/useWorkflowModeSwitching', () => ({
  useWorkflowModeSwitching: () => {},
}));
mock.module('@/features/workflow-builder/hooks/useWorkflowImportExport', () => ({
  useWorkflowImportExport: () => ({ handleImportWorkflow: mock(), handleExportWorkflow: mock() }),
}));
mock.module('@/features/workflow-builder/hooks/useWorkflowKeyboardShortcuts', () => ({
  useWorkflowKeyboardShortcuts: () => {},
}));
mock.module('@/features/workflow-builder/hooks/useWorkflowChangeHandlers', () => ({
  useWorkflowChangeHandlers: () => ({
    onNodesChange: mock(),
    onEdgesChange: mock(),
    navigateToSchedules: mock(),
  }),
}));
mock.module('@/features/workflow-builder/hooks/useRuntimeInputResolver', () => ({
  useRuntimeInputResolver: () => ({
    resolveRuntimeInputDefinitions: mock(),
    resolveRuntimeInputDefaults: mock(),
  }),
}));

// --- Module mocks: child components ---
mock.module('@/components/workflow/WorkflowBuilderShell', () => ({
  WorkflowBuilderShell: (props: Record<string, unknown>) => (
    <div data-testid="builder-shell" data-mode={props.mode as string}>
      {props.topBar as React.ReactNode}
      {(props.isLibraryVisible as boolean) && (props.libraryContent as React.ReactNode)}
      {props.canvasContent as React.ReactNode}
      {(props.isInspectorVisible as boolean) && (props.inspectorContent as React.ReactNode)}
      {props.runDialog as React.ReactNode}
      {props.executionOverlay as React.ReactNode}
      {props.terminalDockContent as React.ReactNode}
    </div>
  ),
}));
mock.module('@/components/layout/TopBar', () => ({
  TopBar: (props: Record<string, unknown>) => {
    capturedTopBarProps = props;
    return (
      <div role="toolbar" aria-label="workflow toolbar">
        TopBar
      </div>
    );
  },
}));
mock.module('@/components/layout/Sidebar', () => ({
  Sidebar: () => <div aria-label="component library">Sidebar</div>,
}));
mock.module('@/components/timeline/ExecutionInspector', () => ({
  ExecutionInspector: () => (
    <div role="complementary" aria-label="execution inspector">
      ExecutionInspector
    </div>
  ),
}));
mock.module('@/components/timeline/RunBreadcrumbs', () => ({
  RunBreadcrumbs: () => <div data-testid="run-breadcrumbs">RunBreadcrumbs</div>,
}));
mock.module('@/components/workflow/RunWorkflowDialog', () => ({
  RunWorkflowDialog: (props: Record<string, unknown>) => (
    <div data-testid="run-dialog" data-open={String(props.open)}>
      RunDialog
    </div>
  ),
}));
mock.module('@/components/terminal/TerminalDockPanel', () => ({
  TerminalDockPanel: () => <div data-testid="terminal-dock">TerminalDock</div>,
}));
mock.module('@/features/templates/PublishTemplateModal', () => ({
  PublishTemplateModal: () => <div data-testid="publish-modal">PublishTemplateModal</div>,
}));
mock.module('@/features/workflow-builder/components/VersionHistoryPanel', () => ({
  VersionHistoryPanel: () => <div data-testid="version-history">VersionHistoryPanel</div>,
}));
mock.module('@/features/workflow-builder/components/WorkflowDesignerPane', () => ({
  WorkflowDesignerPane: () => <div data-testid="designer-pane">DesignerPane</div>,
}));
mock.module('@/features/workflow-builder/components/WorkflowExecutionPane', () => ({
  WorkflowExecutionPane: () => <div data-testid="execution-pane">ExecutionPane</div>,
}));
mock.module('@/features/workflow-builder/components/HistoryDebugger', () => ({
  HistoryDebugger: () => <div data-testid="history-debugger">HistoryDebugger</div>,
}));

// Import component AFTER mocks
import { WorkflowBuilder } from '@/features/workflow-builder/WorkflowBuilder';

// --- Helpers ---
const resetMockState = (
  o: {
    route?: { params?: Partial<typeof mockRouteState.params>; pathname?: string };
    store?: Partial<typeof mockWorkflowStore>;
    ui?: Partial<typeof mockUiStore>;
    timeline?: Partial<typeof mockTimelineStore>;
    loader?: Partial<typeof mockLoaderState>;
    runner?: Partial<typeof mockRunnerState>;
    history?: Partial<typeof mockHistoryState>;
    designNodes?: unknown[];
    executionNodes?: unknown[];
  } = {},
) => {
  mockRouteState.params = { id: 'wf-123', runId: undefined, ...o.route?.params };
  mockRouteState.pathname = o.route?.pathname ?? '/workflows/wf-123';
  Object.assign(mockWorkflowStore, {
    metadata: { id: 'wf-123', name: 'Test Workflow', currentVersionId: 'v1' },
    isDirty: false,
    ...o.store,
  });
  Object.assign(mockUiStore, {
    mode: 'design',
    libraryOpen: false,
    showDemoComponents: false,
    configPanelOpen: false,
    schedulesPanelOpen: false,
    versionHistoryPanelOpen: false,
    ...o.ui,
  });
  mockTimelineStore.selectedRunId = o.timeline?.selectedRunId ?? null;
  Object.assign(mockLoaderState, { isLoading: false, ...o.loader });
  Object.assign(mockRunnerState, {
    runDialogOpen: false,
    runtimeInputs: [],
    prefilledRuntimeValues: {},
    pendingVersionId: null,
    ...o.runner,
  });
  Object.assign(mockHistoryState, { canUndo: false, canRedo: false, ...o.history });
  mockGraphControllers.design.nodes = o.designNodes ?? [];
  mockGraphControllers.design.edges = [];
  mockGraphControllers.execution.nodes = o.executionNodes ?? [];
  mockGraphControllers.execution.edges = [];
  capturedTopBarProps = {};
  mockNavigate.mockClear();
};

const renderBuilder = () => renderWithProviders(<WorkflowBuilder />);

// --- Teardown ---
const MOCKED = [
  'reactflow',
  'react-router-dom',
  '@/components/ui/use-toast',
  '@/hooks/useDocumentTitle',
  '@/hooks/useIsMobile',
  '@/utils/auth',
  '@/hooks/queries/useRunQueries',
  '@/hooks/queries/useComponentQueries',
  '@/features/workflow-builder/workflowBuilderUtils',
  '@/store/workflowStore',
  '@/store/workflowUiStore',
  '@/store/executionTimelineStore',
  '@/store/authStore',
  '@/features/workflow-builder/hooks/useWorkflowGraphControllers',
  '@/features/workflow-builder/hooks/useWorkflowLoader',
  '@/features/workflow-builder/hooks/useWorkflowRunner',
  '@/features/workflow-builder/hooks/useWorkflowHistory',
  '@/features/workflow-builder/hooks/useDesignWorkflowPersistence',
  '@/features/workflow-builder/hooks/useWorkflowExecutionLifecycle',
  '@/features/workflow-builder/hooks/useWorkflowModeSwitching',
  '@/features/workflow-builder/hooks/useWorkflowImportExport',
  '@/features/workflow-builder/hooks/useWorkflowKeyboardShortcuts',
  '@/features/workflow-builder/hooks/useWorkflowChangeHandlers',
  '@/features/workflow-builder/hooks/useRuntimeInputResolver',
  '@/components/workflow/WorkflowBuilderShell',
  '@/components/layout/TopBar',
  '@/components/layout/Sidebar',
  '@/components/timeline/ExecutionInspector',
  '@/components/timeline/RunBreadcrumbs',
  '@/components/workflow/RunWorkflowDialog',
  '@/components/terminal/TerminalDockPanel',
  '@/features/templates/PublishTemplateModal',
  '@/features/workflow-builder/components/VersionHistoryPanel',
  '@/features/workflow-builder/components/WorkflowDesignerPane',
  '@/features/workflow-builder/components/WorkflowExecutionPane',
  '@/features/workflow-builder/components/HistoryDebugger',
];
afterAll(() => restoreMockedModules(MOCKED));

// --- Tests ---
describe('WorkflowBuilder', () => {
  beforeEach(() => {
    cleanup();
    resetMockState();
  });
  afterEach(cleanup);

  // ─── Loading state ───────────────────────────────────────────────────
  describe('loading state', () => {
    it('shows loading spinner for existing workflow when loading with no nodes', () => {
      resetMockState({ loader: { isLoading: true } });
      renderBuilder();
      expect(screen.getByText('Loading workflow...')).toBeInTheDocument();
    });

    it('does not show loading spinner for new workflow even when loading', () => {
      resetMockState({
        route: { params: { id: 'new' }, pathname: '/workflows/new' },
        store: { metadata: { id: null, name: '', currentVersionId: null } },
        loader: { isLoading: true },
      });
      renderBuilder();
      expect(screen.queryByText('Loading workflow...')).not.toBeInTheDocument();
    });

    it('does not show loading spinner when design nodes exist', () => {
      resetMockState({
        loader: { isLoading: true },
        designNodes: [{ id: 'n1', type: 'default', position: { x: 0, y: 0 }, data: {} }],
      });
      renderBuilder();
      expect(screen.queryByText('Loading workflow...')).not.toBeInTheDocument();
    });

    it('does not show loading spinner when execution nodes exist', () => {
      resetMockState({
        loader: { isLoading: true },
        executionNodes: [{ id: 'n1', type: 'default', position: { x: 0, y: 0 }, data: {} }],
      });
      renderBuilder();
      expect(screen.queryByText('Loading workflow...')).not.toBeInTheDocument();
    });
  });

  // ─── Core rendering ─────────────────────────────────────────────────
  describe('core rendering', () => {
    it('renders WorkflowBuilderShell when loaded', () => {
      resetMockState();
      renderBuilder();
      expect(screen.getByTestId('builder-shell')).toBeInTheDocument();
    });

    it('renders TopBar inside the shell', () => {
      resetMockState();
      renderBuilder();
      expect(screen.getByRole('toolbar', { name: 'workflow toolbar' })).toBeInTheDocument();
    });

    it('renders RunWorkflowDialog', () => {
      resetMockState();
      renderBuilder();
      expect(screen.getByTestId('run-dialog')).toBeInTheDocument();
    });
  });

  // ─── Mode switching ─────────────────────────────────────────────────
  describe('mode switching', () => {
    it('renders WorkflowDesignerPane in design mode', () => {
      resetMockState({ ui: { mode: 'design' } });
      renderBuilder();
      expect(screen.getByText('DesignerPane')).toBeInTheDocument();
      expect(screen.queryByText('ExecutionPane')).not.toBeInTheDocument();
    });

    it('renders WorkflowExecutionPane in execution mode', () => {
      resetMockState({ ui: { mode: 'execution' } });
      renderBuilder();
      expect(screen.getByText('ExecutionPane')).toBeInTheDocument();
      expect(screen.queryByText('DesignerPane')).not.toBeInTheDocument();
    });

    it('renders ExecutionInspector in execution mode', () => {
      resetMockState({ ui: { mode: 'execution' } });
      renderBuilder();
      expect(
        screen.getByRole('complementary', { name: 'execution inspector' }),
      ).toBeInTheDocument();
    });

    it('does not render ExecutionInspector in design mode', () => {
      resetMockState({ ui: { mode: 'design' } });
      renderBuilder();
      expect(
        screen.queryByRole('complementary', { name: 'execution inspector' }),
      ).not.toBeInTheDocument();
    });
  });

  // ─── Library sidebar ────────────────────────────────────────────────
  describe('library sidebar', () => {
    it('shows library sidebar when libraryOpen and design mode', () => {
      resetMockState({ ui: { mode: 'design', libraryOpen: true } });
      renderBuilder();
      expect(screen.getByLabelText('component library')).toBeInTheDocument();
    });

    it('hides library sidebar in execution mode even when libraryOpen', () => {
      resetMockState({ ui: { mode: 'execution', libraryOpen: true } });
      renderBuilder();
      // Sidebar renders as libraryContent but isLibraryVisible is false
      expect(screen.queryByLabelText('component library')).not.toBeInTheDocument();
    });

    it('hides library sidebar when libraryOpen is false in design mode', () => {
      resetMockState({ ui: { mode: 'design', libraryOpen: false } });
      renderBuilder();
      expect(screen.queryByLabelText('component library')).not.toBeInTheDocument();
    });
  });

  // ─── Conditional rendering ──────────────────────────────────────────
  describe('conditional rendering', () => {
    it('renders PublishTemplateModal for existing workflow', () => {
      resetMockState();
      renderBuilder();
      expect(screen.getByTestId('publish-modal')).toBeInTheDocument();
    });

    it('does not render PublishTemplateModal for new workflow', () => {
      resetMockState({
        route: { params: { id: 'new' }, pathname: '/workflows/new' },
        store: { metadata: { id: null, name: '', currentVersionId: null } },
      });
      renderBuilder();
      expect(screen.queryByTestId('publish-modal')).not.toBeInTheDocument();
    });

    it('renders VersionHistoryPanel for existing workflow', () => {
      resetMockState();
      renderBuilder();
      expect(screen.getByTestId('version-history')).toBeInTheDocument();
    });

    it('does not render VersionHistoryPanel for new workflow', () => {
      resetMockState({
        route: { params: { id: 'new' }, pathname: '/workflows/new' },
        store: { metadata: { id: null, name: '', currentVersionId: null } },
      });
      renderBuilder();
      expect(screen.queryByTestId('version-history')).not.toBeInTheDocument();
    });

    it('renders HistoryDebugger when showDemoComponents is true in design mode', () => {
      resetMockState({ ui: { mode: 'design', showDemoComponents: true } });
      renderBuilder();
      expect(screen.getByText('HistoryDebugger')).toBeInTheDocument();
    });

    it('does not render HistoryDebugger when showDemoComponents is false', () => {
      resetMockState({ ui: { mode: 'design', showDemoComponents: false } });
      renderBuilder();
      expect(screen.queryByText('HistoryDebugger')).not.toBeInTheDocument();
    });

    it('does not render HistoryDebugger in execution mode even when showDemoComponents is true', () => {
      resetMockState({ ui: { mode: 'execution', showDemoComponents: true } });
      renderBuilder();
      expect(screen.queryByText('HistoryDebugger')).not.toBeInTheDocument();
    });
  });

  // ─── TopBar callbacks ──────────────────────────────────────────────
  describe('TopBar callbacks', () => {
    it('passes callback handlers to TopBar', () => {
      resetMockState();
      renderBuilder();
      expect(typeof capturedTopBarProps.onSave).toBe('function');
      expect(typeof capturedTopBarProps.onRun).toBe('function');
      expect(typeof capturedTopBarProps.onImport).toBe('function');
      expect(typeof capturedTopBarProps.onExport).toBe('function');
      expect(typeof capturedTopBarProps.onUndo).toBe('function');
      expect(typeof capturedTopBarProps.onRedo).toBe('function');
      expect(typeof capturedTopBarProps.onPublishTemplate).toBe('function');
    });

    it('passes workflow id and undo/redo state to TopBar', () => {
      resetMockState({ history: { canUndo: true, canRedo: false } });
      renderBuilder();
      expect(capturedTopBarProps.workflowId).toBe('wf-123');
      expect(capturedTopBarProps.canUndo).toBe(true);
      expect(capturedTopBarProps.canRedo).toBe(false);
    });
  });
});
