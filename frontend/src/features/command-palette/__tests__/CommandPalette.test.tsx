import { describe, it, expect, mock, beforeEach, afterEach, afterAll } from 'bun:test';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createDialogMock } from '@/test/mocks/dialog';
import { createStoreMock } from '@/test/mocks/createStoreMock';
import { realModuleExports, restoreMockedModules } from '@/test/restore-mocks';

// ---------------------------------------------------------------------------
// Mutable mock state
// ---------------------------------------------------------------------------

let mockIsOpen = true;
const mockClose = mock(() => {});
const mockNavigate = mock(() => {});
const mockSetPlacement = mock(() => {});

// ---------------------------------------------------------------------------
// Module mocks (BEFORE component import)
// ---------------------------------------------------------------------------

// --- Dialog: passthrough ---
mock.module('@/components/ui/dialog', createDialogMock);

// --- Command Palette Store ---
mock.module('@/store/commandPaletteStore', () => ({
  useCommandPaletteStore: createStoreMock(() => ({
    isOpen: mockIsOpen,
    close: mockClose,
  })),
}));

// --- Theme Store ---
mock.module('@/store/themeStore', () => ({
  useThemeStore: createStoreMock({
    theme: 'dark',
    startTransition: mock(() => {}),
  }),
}));

// --- Workflow UI Store ---
mock.module('@/store/workflowUiStore', () => ({
  useWorkflowUiStore: createStoreMock({ mode: 'design' }),
}));

// --- Workflow Store ---
mock.module('@/store/workflowStore', () => ({
  useWorkflowStore: createStoreMock({ metadata: { id: 'wf-123' } }),
}));

// --- Placement Store ---
mock.module('@/components/layout/sidebar-state', () => ({
  usePlacementStore: createStoreMock({ setPlacement: mockSetPlacement }),
}));

// --- React Router ---
mock.module('react-router-dom', () => ({
  ...realModuleExports('react-router-dom'),
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/', search: '', hash: '', state: null, key: 'test' }),
}));

// --- Config env ---
mock.module('@/config/env', () => ({
  env: {
    VITE_ENABLE_CONNECTIONS: false,
    VITE_ENABLE_IT_OPS: false,
  },
}));

// --- Entity queries ---
mock.module('@/hooks/queries/useComponentQueries', () => ({
  useComponents: () => ({ data: { byId: {} }, isLoading: false }),
}));

mock.module('@/hooks/queries/useWorkflowQueries', () => ({
  useWorkflowsList: () => ({ data: [], isLoading: false }),
}));

mock.module('@/hooks/queries/useTemplateQueries', () => ({
  useTemplates: () => ({ data: [] }),
}));

mock.module('@/hooks/queries/useScheduleQueries', () => ({
  useSchedules: () => ({ data: [] }),
}));

mock.module('@/hooks/queries/useSecretQueries', () => ({
  useSecrets: () => ({ data: [] }),
}));

mock.module('@/hooks/queries/useApiKeyQueries', () => ({
  useApiKeys: () => ({ data: [] }),
}));

mock.module('@/hooks/queries/useWebhookQueries', () => ({
  useWebhooks: () => ({ data: [] }),
}));

mock.module('@/schemas/workflow', () => ({
  WorkflowMetadataSchema: { parse: (w: any) => w },
}));

// --- DynamicIcon ---
mock.module('@/components/ui/DynamicIcon', () => ({
  DynamicIcon: ({ name, className }: any) => (
    <span data-testid="dynamic-icon" data-name={name} className={className} />
  ),
}));

// Import component AFTER mocks
import { CommandPalette } from '../CommandPalette';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPalette() {
  return render(
    <MemoryRouter>
      <CommandPalette />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockIsOpen = true;
  mockClose.mockClear();
  mockNavigate.mockClear();
  mockSetPlacement.mockClear();
});

afterEach(() => {
  cleanup();
});

afterAll(() =>
  restoreMockedModules([
    '@/components/layout/sidebar-state',
    '@/components/ui/dialog',
    '@/components/ui/DynamicIcon',
    '@/config/env',
    '@/hooks/queries/useApiKeyQueries',
    '@/hooks/queries/useComponentQueries',
    '@/hooks/queries/useScheduleQueries',
    '@/hooks/queries/useSecretQueries',
    '@/hooks/queries/useTemplateQueries',
    '@/hooks/queries/useWebhookQueries',
    '@/hooks/queries/useWorkflowQueries',
    '@/schemas/workflow',
    '@/store/commandPaletteStore',
    '@/store/themeStore',
    '@/store/workflowStore',
    '@/store/workflowUiStore',
    'react-router-dom',
  ]),
);

describe('CommandPalette', () => {
  it('renders when isOpen is true', () => {
    renderPalette();

    // Should render the search input
    expect(screen.getByLabelText('Search commands')).toBeDefined();
  });

  it('does not render content when isOpen is false', () => {
    mockIsOpen = false;
    renderPalette();

    // Dialog mock renders nothing when open=false
    expect(screen.queryByLabelText('Search commands')).toBeNull();
  });

  it('renders search input with correct placeholder', () => {
    renderPalette();

    const input = screen.getByLabelText('Search commands');
    expect(input).toBeDefined();
    expect(input.getAttribute('placeholder')).toContain('Search commands');
  });

  it('shows static commands when open with no query', () => {
    renderPalette();

    // Should display static command labels like "Workflows", "Schedules", etc.
    expect(screen.getByText('Workflows')).toBeDefined();
    expect(screen.getByText('Secrets')).toBeDefined();
  });

  it('filters commands when typing in search input', async () => {
    renderPalette();

    const input = screen.getByLabelText('Search commands');
    fireEvent.change(input, { target: { value: 'secrets' } });

    await waitFor(() => {
      expect(screen.getByText('Secrets')).toBeDefined();
    });
  });

  it('shows "No results found" for non-matching query', async () => {
    renderPalette();

    const input = screen.getByLabelText('Search commands');
    fireEvent.change(input, { target: { value: 'zzznonexistentzzzzzz' } });

    await waitFor(() => {
      expect(screen.getByText('No results found')).toBeDefined();
    });
  });

  it('calls close on Escape key within the palette input', () => {
    renderPalette();

    const input = screen.getByLabelText('Search commands');
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(mockClose).toHaveBeenCalled();
  });

  it('navigates on Enter key for a selected navigation command', () => {
    renderPalette();

    const input = screen.getByLabelText('Search commands');
    // Press Enter to execute the first selected (default index 0) command
    fireEvent.keyDown(input, { key: 'Enter' });

    // The first command should trigger navigation
    // mockNavigate should be called (the exact arg depends on the first static command)
    expect(mockNavigate).toHaveBeenCalled();
  });

  it('supports arrow key navigation', () => {
    renderPalette();

    const input = screen.getByLabelText('Search commands');

    // Arrow down should work without crashing
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });

    // No crash = success; we verify by being able to press Enter after
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockNavigate).toHaveBeenCalled();
  });

  it('clears search query state on re-open', () => {
    const { rerender } = render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );

    // Type a query
    const input = screen.getByLabelText('Search commands');
    fireEvent.change(input, { target: { value: 'test query' } });

    // Close and re-open
    mockIsOpen = false;
    rerender(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );

    mockIsOpen = true;
    rerender(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );

    // Input should be cleared
    const refreshedInput = screen.getByLabelText('Search commands') as HTMLInputElement;
    expect(refreshedInput.value).toBe('');
  });
});
