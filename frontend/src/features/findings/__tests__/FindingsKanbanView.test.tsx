import { describe, it, expect, afterEach, vi, mock } from 'bun:test';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing components
// ---------------------------------------------------------------------------

const updateTriageMutateMock = vi.fn();
const bulkTriageMutateMock = vi.fn();
const orgMembersDataMock = {
  members: [
    {
      userId: 'user-1',
      displayName: 'Jane Engineer',
      email: 'jane@example.com',
      role: 'ADMIN',
      avatarUrl: null,
    },
    {
      userId: 'user-2',
      displayName: 'Bob Dev',
      email: 'bob@example.com',
      role: 'MEMBER',
      avatarUrl: null,
    },
  ],
};

mock.module('@/hooks/queries/useFindingsQueries', () => ({
  useUpdateTriageMutation: () => ({
    mutate: updateTriageMutateMock,
    isPending: false,
  }),
  useBulkTriageMutation: () => ({
    mutate: bulkTriageMutateMock,
    isPending: false,
  }),
  useOrgMembersQuery: () => ({
    data: orgMembersDataMock,
    isLoading: false,
  }),
}));

mock.module('@/components/ui/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

// Mock @dnd-kit/core fully — JSDOM doesn't support pointer events properly
const mockDroppableResults = new Map<string, { isOver: boolean }>();

mock.module('@dnd-kit/core', () => ({
  DndContext: ({ children }: any) => <div data-testid="dnd-context">{children}</div>,
  DragOverlay: ({ children }: any) => <div data-testid="drag-overlay">{children}</div>,
  PointerSensor: class PointerSensor {},
  KeyboardSensor: class KeyboardSensor {},
  useSensor: (SensorClass: any, _opts?: any) => SensorClass,
  useSensors: (...sensors: any[]) => sensors,
  useDraggable: ({ id }: any) => ({
    attributes: { role: 'button', tabIndex: 0, 'data-draggable-id': id },
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    isDragging: false,
  }),
  useDroppable: ({ id }: any) => ({
    setNodeRef: (el: any) => el,
    isOver: mockDroppableResults.get(id)?.isOver ?? false,
  }),
}));

mock.module('@dnd-kit/utilities', () => ({
  CSS: { Translate: { toString: () => '' } },
}));

// Mock Select components for testability in JSDOM
mock.module('@/components/ui/select', () => ({
  Select: ({ children, onValueChange, value, disabled }: any) => (
    <div data-testid="select-root" data-value={value} data-disabled={disabled}>
      {typeof children === 'function' ? children({ onValueChange }) : children}
    </div>
  ),
  SelectTrigger: ({ children, ...props }: any) => (
    <button data-testid="select-trigger" {...props}>
      {children}
    </button>
  ),
  SelectContent: ({ children }: any) => <div data-testid="select-content">{children}</div>,
  SelectItem: ({ children, value }: any) => (
    <div data-testid={`select-item-${value}`} data-value={value}>
      {children}
    </div>
  ),
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
}));

// Mock Popover components similarly
mock.module('@/components/ui/popover', () => ({
  Popover: ({ children, open }: any) => (
    <div data-testid="popover" data-open={open}>
      {children}
    </div>
  ),
  PopoverTrigger: ({ children, asChild: _asChild }: any) => <>{children}</>,
  PopoverContent: ({ children }: any) => <div data-testid="popover-content">{children}</div>,
}));

// Import components AFTER mocks
import { FindingsKanbanView } from '../FindingsKanbanView';
import { BulkActionsToolbar } from '../BulkActionsToolbar';
import { FindingTriageControls } from '../FindingTriageControls';
import type { FindingWithTriage } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function Wrapper({ children }: { children: ReactNode }) {
  const qc = createTestQueryClient();
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

function makeFinding(overrides: Partial<FindingWithTriage> = {}): FindingWithTriage {
  return {
    id: overrides.id ?? 'finding-1',
    timestamp: '2026-03-04T12:00:00.000Z',
    severity: overrides.severity ?? 'high',
    name: overrides.name ?? 'SQL Injection',
    asset_key: 'example.com',
    workflow_name: 'Web Scan',
    workflow_id: 'wf-1',
    run_id: 'run-1',
    component_id: 'comp-1',
    node_ref: 'node-1',
    raw: {},
    triage: overrides.triage ?? null,
    ...overrides,
  } as FindingWithTriage;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockDroppableResults.clear();
});

// ---------------------------------------------------------------------------
// FindingsKanbanView
// ---------------------------------------------------------------------------

describe('FindingsKanbanView', () => {
  it('renders columns for all status values', () => {
    render(<FindingsKanbanView items={[]} isLoading={false} onCardClick={vi.fn()} />, {
      wrapper: Wrapper,
    });

    // Each column has an aria-label with the status label
    expect(screen.getByLabelText(/New column/i)).toBeTruthy();
    expect(screen.getByLabelText(/Triaged column/i)).toBeTruthy();
    expect(screen.getByLabelText(/In Progress column/i)).toBeTruthy();
    expect(screen.getByLabelText(/Fixed column/i)).toBeTruthy();
    expect(screen.getByLabelText(/Verified column/i)).toBeTruthy();
    expect(screen.getByLabelText(/Won't Fix column/i)).toBeTruthy();
    expect(screen.getByLabelText(/Accepted Risk column/i)).toBeTruthy();
  });

  it('shows finding cards in correct columns based on triage status', () => {
    const items = [
      makeFinding({ id: 'f-new', name: 'New Finding', triage: null }),
      makeFinding({
        id: 'f-triaged',
        name: 'Triaged Finding',
        triage: {
          status: 'triaged',
          assigneeUserId: null,
          severityOverride: null,
          notes: null,
          updatedAt: '2026-03-04T12:00:00Z',
        },
      }),
      makeFinding({
        id: 'f-fixed',
        name: 'Fixed Finding',
        triage: {
          status: 'fixed',
          assigneeUserId: null,
          severityOverride: null,
          notes: null,
          updatedAt: '2026-03-04T12:00:00Z',
        },
      }),
    ];

    render(<FindingsKanbanView items={items} isLoading={false} onCardClick={vi.fn()} />, {
      wrapper: Wrapper,
    });

    // New column should contain 1 finding (null triage → new)
    const newColumn = screen.getByLabelText(/New column, 1 finding/i);
    expect(newColumn).toBeTruthy();

    // Triaged column should contain 1 finding
    const triagedColumn = screen.getByLabelText(/Triaged column, 1 finding/i);
    expect(triagedColumn).toBeTruthy();

    // Fixed column should contain 1 finding
    const fixedColumn = screen.getByLabelText(/Fixed column, 1 finding/i);
    expect(fixedColumn).toBeTruthy();
  });

  it('shows count badges per column', () => {
    const items = [
      makeFinding({ id: 'f-1', name: 'Finding 1' }),
      makeFinding({ id: 'f-2', name: 'Finding 2' }),
    ];

    render(<FindingsKanbanView items={items} isLoading={false} onCardClick={vi.fn()} />, {
      wrapper: Wrapper,
    });

    // Both findings go to "new" column (no triage data), so count is "2"
    const newColumn = screen.getByLabelText(/New column, 2 findings/i);
    expect(newColumn).toBeTruthy();
  });

  it('shows loading skeletons while fetching', () => {
    const { container } = render(
      <FindingsKanbanView items={[]} isLoading={true} onCardClick={vi.fn()} />,
      { wrapper: Wrapper },
    );

    // Skeleton elements should be present in loading state
    // Each column renders 3 skeletons
    const skeletons = container.querySelectorAll(
      '[class*="animate-pulse"], [data-slot="skeleton"]',
    );
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renders the kanban board region', () => {
    render(<FindingsKanbanView items={[]} isLoading={false} onCardClick={vi.fn()} />, {
      wrapper: Wrapper,
    });

    expect(screen.getByRole('region', { name: /Kanban board/i })).toBeTruthy();
  });

  it('handles finding card click', () => {
    const onCardClick = vi.fn();
    const items = [makeFinding({ id: 'f-1', name: 'Clickable Finding' })];

    render(<FindingsKanbanView items={items} isLoading={false} onCardClick={onCardClick} />, {
      wrapper: Wrapper,
    });

    // Card is rendered as a button with aria-label
    const card = screen.getByLabelText(/Finding: Clickable Finding/i);
    fireEvent.keyDown(card, { key: 'Enter' });

    expect(onCardClick).toHaveBeenCalledWith('f-1');
  });
});

// ---------------------------------------------------------------------------
// BulkActionsToolbar
// ---------------------------------------------------------------------------

describe('BulkActionsToolbar', () => {
  it('shows selected count', () => {
    const selectedIds = new Set(['f-1', 'f-2', 'f-3']);

    render(<BulkActionsToolbar selectedIds={selectedIds} onClearSelection={vi.fn()} />, {
      wrapper: Wrapper,
    });

    expect(screen.getByText('3 items selected')).toBeTruthy();
  });

  it('shows singular text for single selection', () => {
    render(<BulkActionsToolbar selectedIds={new Set(['f-1'])} onClearSelection={vi.fn()} />, {
      wrapper: Wrapper,
    });

    expect(screen.getByText('1 item selected')).toBeTruthy();
  });

  it('renders the toolbar with correct role', () => {
    render(<BulkActionsToolbar selectedIds={new Set(['f-1'])} onClearSelection={vi.fn()} />, {
      wrapper: Wrapper,
    });

    expect(screen.getByRole('toolbar', { name: /bulk actions/i })).toBeTruthy();
  });

  it('clear selection button calls onClearSelection', () => {
    const clearMock = vi.fn();

    render(
      <BulkActionsToolbar selectedIds={new Set(['f-1', 'f-2'])} onClearSelection={clearMock} />,
      { wrapper: Wrapper },
    );

    const clearButton = screen.getByLabelText('Clear selection');
    fireEvent.click(clearButton);

    expect(clearMock).toHaveBeenCalledTimes(1);
  });

  it('renders Set Status and Assign To buttons', () => {
    render(<BulkActionsToolbar selectedIds={new Set(['f-1'])} onClearSelection={vi.fn()} />, {
      wrapper: Wrapper,
    });

    expect(screen.getByText('Set Status')).toBeTruthy();
    expect(screen.getByText('Assign To')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// FindingTriageControls
// ---------------------------------------------------------------------------

describe('FindingTriageControls', () => {
  const defaultProps = {
    findingId: 'f-1',
    currentStatus: 'new' as const,
    assigneeUserId: null,
    severityOverride: null,
    notes: null,
  };

  it('renders status, assignee, severity override, and notes sections', () => {
    render(<FindingTriageControls {...defaultProps} />, { wrapper: Wrapper });

    expect(screen.getByText('Status')).toBeTruthy();
    expect(screen.getByText('Assignee')).toBeTruthy();
    expect(screen.getByText('Severity Override')).toBeTruthy();
    expect(screen.getByText('Notes')).toBeTruthy();
  });

  it('renders notes textarea with placeholder', () => {
    render(<FindingTriageControls {...defaultProps} />, { wrapper: Wrapper });

    const textarea = screen.getByPlaceholderText('Add triage notes…');
    expect(textarea).toBeTruthy();
  });

  it('shows dirty save button when notes are modified', async () => {
    render(<FindingTriageControls {...defaultProps} />, { wrapper: Wrapper });

    const textarea = screen.getByPlaceholderText('Add triage notes…');
    fireEvent.change(textarea, { target: { value: 'New note content' } });

    await waitFor(() => {
      expect(screen.getByText('Save notes')).toBeTruthy();
    });
  });

  it('calls mutation when notes save button is clicked', async () => {
    render(<FindingTriageControls {...defaultProps} />, { wrapper: Wrapper });

    const textarea = screen.getByPlaceholderText('Add triage notes…');
    fireEvent.change(textarea, { target: { value: 'Important note' } });

    await waitFor(() => {
      expect(screen.getByText('Save notes')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Save notes'));

    expect(updateTriageMutateMock).toHaveBeenCalledTimes(1);
    const callArgs = updateTriageMutateMock.mock.calls[0]![0];
    expect(callArgs.findingId).toBe('f-1');
    expect(callArgs.data.notes).toBe('Important note');
  });

  it('displays initial notes value', () => {
    render(<FindingTriageControls {...defaultProps} notes="Existing note" />, { wrapper: Wrapper });

    const textarea = screen.getByPlaceholderText('Add triage notes…') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Existing note');
  });
});
