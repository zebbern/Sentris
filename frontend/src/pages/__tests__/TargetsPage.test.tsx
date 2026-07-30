import { describe, it, beforeEach, afterEach, expect, mock } from 'bun:test';
import { fireEvent, screen, cleanup, waitFor } from '@testing-library/react';
import type { Scope } from '@/types/scopes';
import { createDialogMock, createAlertDialogMock } from '@/test/mocks/dialog';
import { createAuthStoreMock } from '@/test/mocks/auth-store';
import { renderWithProviders } from '@/test/render-with-providers';

// --- Mock dialog components (passthrough for test rendering) ---
mock.module('@/components/ui/dialog', createDialogMock);
mock.module('@/components/ui/alert-dialog', createAlertDialogMock);

// --- Mock useConfirmDialog (prevents cross-file contamination from other test files) ---
const mockConfirm = mock().mockResolvedValue(false);
mock.module('@/hooks/useConfirmDialog', () => ({
  useConfirmDialog: () => ({
    confirm: mockConfirm,
    dialogProps: {
      open: false,
      title: '',
      description: '',
      confirmLabel: 'Confirm',
      cancelLabel: 'Cancel',
      destructive: false,
      onConfirm: () => {},
      onCancel: () => {},
    },
  }),
}));

// --- Mutable mock state for scope queries ---
const mockQueryState: {
  scopes: Scope[];
  isLoading: boolean;
  error: Error | null;
  deleteScope: any;
} = {
  scopes: [],
  isLoading: false,
  error: null,
  deleteScope: mock().mockResolvedValue(undefined),
};

mock.module('@/hooks/queries/useScopeQueries', () => ({
  useScopes: () => ({
    data: mockQueryState.scopes,
    isLoading: mockQueryState.isLoading,
    error: mockQueryState.error,
  }),
  useDeleteScope: () => ({
    mutateAsync: mockQueryState.deleteScope,
  }),
}));

// --- Mock the API layer used directly by the editor state hook ---
const mockCreateScope = mock((payload: any) =>
  Promise.resolve({
    id: 'scope-new',
    organizationId: 'org-001',
    createdBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...payload,
  }),
);
const mockUpdateScope = mock((id: string, payload: any) =>
  Promise.resolve({
    id,
    organizationId: 'org-001',
    createdBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    name: 'Updated',
    domains: [],
    repos: [],
    ipRanges: [],
    runtimeValues: {},
    ...payload,
  }),
);

mock.module('@/services/api', () => ({
  api: {
    scopes: {
      create: mockCreateScope,
      update: mockUpdateScope,
    },
  },
}));

// --- Auth store ---
let mockRoles: string[] = ['ADMIN'];
mock.module('@/store/authStore', () => createAuthStoreMock({ roles: () => mockRoles }));

// --- Toast ---
const mockToast = mock((_opts: any) => {});
mock.module('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mockToast, dismiss: () => {} }),
}));

// Import component AFTER all mock.module() calls
import { TargetsPage } from '@/pages/TargetsPage';

// --- Fixtures ---
const ISO = '2024-06-15T12:00:00.000Z';

const scopeA: Scope = {
  id: 'scope-001',
  organizationId: 'org-001',
  name: 'Contoso Ltd',
  description: 'Primary target',
  domains: ['contoso.com', 'app.contoso.com'],
  repos: ['contoso/infra'],
  ipRanges: [],
  runtimeValues: {},
  createdBy: null,
  createdAt: ISO,
  updatedAt: ISO,
};

const scopeB: Scope = {
  id: 'scope-002',
  organizationId: 'org-001',
  name: 'Fabrikam Inc',
  description: null,
  domains: [],
  repos: [],
  ipRanges: [],
  runtimeValues: {},
  createdBy: null,
  createdAt: ISO,
  updatedAt: ISO,
};

// --- Helpers ---
interface MockQueryOverrides {
  scopes?: Scope[];
  isLoading?: boolean;
  error?: Error | null;
  deleteScope?: (...args: any[]) => Promise<void>;
  roles?: string[];
}

const setupStore = (overrides: MockQueryOverrides = {}) => {
  mockQueryState.scopes = overrides.scopes ?? [scopeA, scopeB];
  mockQueryState.isLoading = overrides.isLoading ?? false;
  mockQueryState.error = overrides.error ?? null;
  mockQueryState.deleteScope = overrides.deleteScope ?? mock().mockResolvedValue(undefined);
  mockRoles = overrides.roles ?? ['ADMIN'];
  mockCreateScope.mockClear();
  mockUpdateScope.mockClear();
  mockToast.mockClear();
};

const renderPage = () => renderWithProviders(<TargetsPage />);

// --- Tests ---
describe('TargetsPage', () => {
  beforeEach(() => {
    cleanup();
    setupStore();
    mockConfirm.mockClear();
    mockConfirm.mockResolvedValue(false);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders a list of scopes', () => {
    setupStore();
    renderPage();

    expect(screen.getByText('Contoso Ltd')).toBeInTheDocument();
    expect(screen.getByText('Fabrikam Inc')).toBeInTheDocument();
    expect(screen.getByText('2 domains · 1 repo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /run contoso ltd/i })).toHaveAttribute(
      'href',
      '/workflows?scopeId=scope-001&launch=1',
    );
  });

  it('shows the empty state with "No targets yet" and an admin "New target" action', () => {
    setupStore({ scopes: [] });
    renderPage();

    expect(screen.getByText('No targets yet')).toBeInTheDocument();
    const newTargetButtons = screen.getAllByRole('button', { name: /New target/i });
    expect(newTargetButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('clicking "New target" opens the editor dialog', () => {
    setupStore();
    renderPage();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /New target/i })[0]!);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Create target')).toBeInTheDocument();
  });

  it('associates every target editor label with its form control', () => {
    setupStore();
    renderPage();

    fireEvent.click(screen.getAllByRole('button', { name: /New target/i })[0]!);

    for (const accessibleName of ['Name', 'Description', 'Domains', 'Repos', 'IP ranges']) {
      expect(screen.getByRole('textbox', { name: accessibleName })).toBeInTheDocument();
    }
  });

  it('submitting the editor with a name calls create', async () => {
    setupStore();
    renderPage();

    fireEvent.click(screen.getAllByRole('button', { name: /New target/i })[0]!);

    const nameInput = screen.getByPlaceholderText('Example Corp');
    fireEvent.change(nameInput, { target: { value: 'New Target Co' } });

    fireEvent.click(screen.getByRole('button', { name: /Save target/i }));

    await waitFor(() => expect(mockCreateScope).toHaveBeenCalledTimes(1));
    expect(mockCreateScope).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'New Target Co',
        domains: [],
        repos: [],
        ipRanges: [],
        runtimeValues: {},
      }),
    );
  });
});
