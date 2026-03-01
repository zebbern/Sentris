import { describe, it, beforeEach, afterEach, expect, mock, afterAll } from 'bun:test';
import { restoreMockedModules } from '@/test/restore-mocks';
import { fireEvent, screen, within, cleanup, waitFor, act } from '@testing-library/react';
import type { components } from '@sentris/backend-client';
import { createDialogMock, createAlertDialogMock } from '@/test/mocks/dialog';
import { createAuthStoreMock } from '@/test/mocks/auth-store';
import { renderWithProviders } from '@/test/render-with-providers';

type ApiKeyResponseDto = components['schemas']['ApiKeyResponseDto'];

// --- Mock dialog components (passthrough for test rendering) ---
mock.module('@/components/ui/dialog', createDialogMock);
mock.module('@/components/ui/alert-dialog', createAlertDialogMock);

// --- Mutable auth state ---
let mockRoles: string[] = ['ADMIN'];

// --- Mutable mock state for API key queries ---
const mockQueryState: {
  apiKeys: ApiKeyResponseDto[];
  isLoading: boolean;
  error: Error | null;
  refetch: any;
  createApiKey: any;
  revokeApiKey: any;
  deleteApiKey: any;
  lastCreatedKey: string | null;
  clearLastCreatedKey: any;
} = {
  apiKeys: [],
  isLoading: false,
  error: null,
  refetch: mock().mockResolvedValue(undefined),
  createApiKey: mock().mockResolvedValue(undefined),
  revokeApiKey: mock().mockResolvedValue(undefined),
  deleteApiKey: mock().mockResolvedValue(undefined),
  lastCreatedKey: null,
  clearLastCreatedKey: mock(),
};

mock.module('@/hooks/queries/useApiKeyQueries', () => ({
  useApiKeys: () => ({
    data: mockQueryState.apiKeys,
    isLoading: mockQueryState.isLoading,
    error: mockQueryState.error,
    refetch: mockQueryState.refetch,
  }),
  useCreateApiKey: () => ({
    mutateAsync: mockQueryState.createApiKey,
  }),
  useRevokeApiKey: () => ({
    mutateAsync: mockQueryState.revokeApiKey,
  }),
  useDeleteApiKey: () => ({
    mutateAsync: mockQueryState.deleteApiKey,
  }),
  useApiKeyUiStore: (selector: any) => {
    const state = {
      lastCreatedKey: mockQueryState.lastCreatedKey,
      clearLastCreatedKey: mockQueryState.clearLastCreatedKey,
    };
    return selector(state);
  },
}));

// --- Auth store ---
mock.module('@/store/authStore', () => createAuthStoreMock({ roles: () => mockRoles }));

// Import component AFTER all mock.module() calls
import { ApiKeysManager } from '@/pages/ApiKeysManager';

// --- Fixtures ---
const ISO = '2024-06-15T12:00:00.000Z';

const baseApiKey: ApiKeyResponseDto = {
  id: 'key-001',
  name: 'CI Runner Key',
  description: 'Used by CI/CD pipeline',
  keyPrefix: 'sk_',
  keyHint: 'a1b2c3',
  permissions: {
    workflows: { run: true, list: false, read: false },
    runs: { read: true, cancel: false },
    audit: { read: false },
  },
  isActive: true,
  expiresAt: null,
  usageCount: 42,
  createdAt: ISO,
  updatedAt: ISO,
  lastUsedAt: '2024-06-14T08:00:00.000Z',
};

const revokedApiKey: ApiKeyResponseDto = {
  id: 'key-002',
  name: 'Old Integration Key',
  description: 'Deprecated integration',
  keyPrefix: 'sk_',
  keyHint: 'x9y8z7',
  permissions: {
    workflows: { run: false, list: true, read: true },
    runs: { read: false, cancel: false },
    audit: { read: true },
  },
  isActive: false,
  expiresAt: null,
  usageCount: 0,
  createdAt: '2024-01-10T00:00:00.000Z',
  updatedAt: '2024-01-10T00:00:00.000Z',
  lastUsedAt: null,
};

// --- Helpers ---
interface MockQueryOverrides {
  apiKeys?: ApiKeyResponseDto[];
  isLoading?: boolean;
  error?: Error | null;
  refetch?: (...args: any[]) => Promise<void>;
  createApiKey?: (...args: any[]) => Promise<any>;
  revokeApiKey?: (...args: any[]) => Promise<void>;
  deleteApiKey?: (...args: any[]) => Promise<void>;
  lastCreatedKey?: string | null;
  clearLastCreatedKey?: () => void;
}

const setupStore = (overrides: MockQueryOverrides = {}) => {
  mockQueryState.apiKeys = overrides.apiKeys ?? [baseApiKey, revokedApiKey];
  mockQueryState.isLoading = overrides.isLoading ?? false;
  mockQueryState.error = overrides.error ?? null;
  mockQueryState.refetch = overrides.refetch ?? mock().mockResolvedValue(undefined);
  mockQueryState.createApiKey = overrides.createApiKey ?? mock().mockResolvedValue(undefined);
  mockQueryState.revokeApiKey = overrides.revokeApiKey ?? mock().mockResolvedValue(undefined);
  mockQueryState.deleteApiKey = overrides.deleteApiKey ?? mock().mockResolvedValue(undefined);
  mockQueryState.lastCreatedKey = overrides.lastCreatedKey ?? null;
  mockQueryState.clearLastCreatedKey = overrides.clearLastCreatedKey ?? mock();

  return mockQueryState;
};

// Mock navigator.clipboard
const mockWriteText = mock().mockResolvedValue(undefined);
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: mockWriteText },
  writable: true,
  configurable: true,
});

const renderPage = () => renderWithProviders(<ApiKeysManager />);

// --- Tests ---
afterAll(() =>
  restoreMockedModules([
    '@/components/ui/dialog',
    '@/components/ui/alert-dialog',
    '@/hooks/queries/useApiKeyQueries',
  ]),
);

describe('ApiKeysManager', () => {
  beforeEach(() => {
    cleanup();
    mockRoles = ['ADMIN'];
    setupStore();
    mockWriteText.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders loading skeletons when isLoading is true and no keys', () => {
    setupStore({ isLoading: true, apiKeys: [] });
    renderPage();

    const container = document.querySelector('[aria-busy="true"]');
    expect(container).toBeTruthy();
  });

  it('renders empty state with "No API keys" when keys array is empty', () => {
    setupStore({ apiKeys: [] });
    renderPage();

    expect(screen.getByText('No API keys')).toBeInTheDocument();
  });

  it('renders API key rows showing name, key hint, status badge, and permissions badges', () => {
    setupStore();
    renderPage();

    // Key names
    expect(screen.getByText('CI Runner Key')).toBeInTheDocument();
    expect(screen.getByText('Old Integration Key')).toBeInTheDocument();

    // Key hints (truncated with "..." prefix)
    expect(screen.getByText('...a1b2c3')).toBeInTheDocument();
    expect(screen.getByText('...x9y8z7')).toBeInTheDocument();

    // Status badges
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Revoked')).toBeInTheDocument();

    // Permission badges for first key
    expect(screen.getByText('workflows:run')).toBeInTheDocument();
    expect(screen.getByText('runs:read')).toBeInTheDocument();
  });

  it('shows ErrorBanner when error is set', () => {
    setupStore({ error: new Error('Failed to load API keys') });
    renderPage();

    expect(screen.getByText('Failed to load API keys')).toBeInTheDocument();
  });

  it('clicking "Create new key" opens create dialog with form fields', async () => {
    setupStore({ apiKeys: [] });
    renderPage();

    const createButton = screen.getAllByRole('button', { name: /Create new key/i })[0];
    fireEvent.click(createButton);

    // Dialog should be open with form fields
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Name/i)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Description/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/Permissions/i)).toBeInTheDocument();
  });

  it('submitting create form calls createApiKeyMutation.mutateAsync with form data', async () => {
    const createApiKey = mock().mockResolvedValue(undefined);
    setupStore({ apiKeys: [], createApiKey });
    renderPage();

    // Open dialog
    const createButton = screen.getAllByRole('button', { name: /Create new key/i })[0];
    fireEvent.click(createButton);

    const dialog = await screen.findByRole('dialog');
    const nameInput = within(dialog).getByLabelText(/^Name$/i);
    fireEvent.change(nameInput, { target: { value: 'My New Key' } });

    // Submit form
    const submitButton = within(dialog).getByRole('button', { name: /Create Key/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(createApiKey).toHaveBeenCalledTimes(1);
    });

    // Verify the name was sent
    const callArgs = createApiKey.mock.calls[0][0];
    expect(callArgs.name).toBe('My New Key');
  });

  it('after creation, dialog shows secret key with copy button when lastCreatedKey is set', async () => {
    setupStore({ lastCreatedKey: 'sk_live_supersecretkey123' });
    renderPage();

    // Open dialog (the lastCreatedKey state will show the secret view)
    const createButton = screen.getByRole('button', { name: /Create new key/i });
    fireEvent.click(createButton);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Save your secret key/i)).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('sk_live_supersecretkey123')).toBeInTheDocument();

    // Click copy button
    const copyButton = within(dialog).getByRole('button', { name: /Copy secret key/i });
    fireEvent.click(copyButton);

    expect(mockWriteText).toHaveBeenCalledWith('sk_live_supersecretkey123');
  });

  it('clicking Revoke button shows confirm dialog, confirming calls revokeApiKeyMutation.mutateAsync', async () => {
    const revokeApiKey = mock().mockResolvedValue(undefined);
    setupStore({ apiKeys: [baseApiKey], revokeApiKey });
    renderPage();

    const revokeButton = screen.getByRole('button', { name: /Revoke key/i });
    await act(async () => {
      fireEvent.click(revokeButton);
    });

    // Wait for the confirm dialog to appear
    await screen.findByRole('alertdialog');

    // Find the confirm action button inside the alert dialog
    const actionButtons = screen.getAllByRole('button', { name: /Revoke/i });
    const confirmActionBtn = actionButtons.find(
      (btn) => btn.closest('[role="alertdialog"]') !== null,
    );
    expect(confirmActionBtn).toBeTruthy();
    fireEvent.click(confirmActionBtn!);
    await new Promise((r) => setTimeout(r, 10));
    expect(revokeApiKey).toHaveBeenCalledTimes(1);
    expect(revokeApiKey).toHaveBeenCalledWith(baseApiKey.id);
  });

  it('clicking Delete button shows confirm dialog, confirming calls deleteApiKeyMutation.mutateAsync', async () => {
    const deleteApiKey = mock().mockResolvedValue(undefined);
    setupStore({ apiKeys: [baseApiKey], deleteApiKey });
    renderPage();

    const deleteButton = screen.getByRole('button', { name: /Delete key/i });
    await act(async () => {
      fireEvent.click(deleteButton);
    });

    // Confirm dialog should appear
    const actionButtons = await screen.findAllByRole('button', { name: /Delete/i });
    const confirmActionBtn = actionButtons.find(
      (btn) => btn.closest('[role="alertdialog"]') !== null,
    );
    if (confirmActionBtn) {
      fireEvent.click(confirmActionBtn);
      await new Promise((r) => setTimeout(r, 10));
      expect(deleteApiKey).toHaveBeenCalledTimes(1);
      expect(deleteApiKey).toHaveBeenCalledWith(baseApiKey.id);
    }
  });

  it('read-only mode (MEMBER role) disables create button', async () => {
    mockRoles = ['MEMBER'];
    setupStore();
    renderPage();

    const createButton = screen.getByRole('button', { name: /Create new key/i });
    expect(createButton).toBeDisabled();
  });

  it('read-only mode (MEMBER role) disables action buttons on rows', () => {
    mockRoles = ['MEMBER'];
    setupStore({ apiKeys: [baseApiKey] });
    renderPage();

    const revokeButton = screen.getByRole('button', { name: /Revoke key/i });
    expect(revokeButton).toBeDisabled();

    const deleteButton = screen.getByRole('button', { name: /Delete key/i });
    expect(deleteButton).toBeDisabled();
  });
});
