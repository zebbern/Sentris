import { describe, it, beforeEach, afterEach, expect, mock } from 'bun:test';
import { fireEvent, render, screen, within, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SecretSummary } from '@/schemas/secret';
import { createDialogMock } from '@/test/mocks/dialog';
import { createAuthStoreMock } from '@/test/mocks/auth-store';
import { ToastContext } from '@/components/ui/toast-context';

mock.module('@/components/ui/dialog', createDialogMock);

// --- Mutable auth state ---
let mockRoles: string[] = ['ADMIN'];

// Mutable mock state for TanStack Query hooks
const mockQueryState: {
  secrets: SecretSummary[];
  isLoading: boolean;
  error: Error | null;
  createSecret: any;
  updateSecret: any;
  rotateSecret: any;
  deleteSecret: any;
} = {
  secrets: [],
  isLoading: false,
  error: null,
  createSecret: mock().mockResolvedValue(undefined),
  updateSecret: mock().mockResolvedValue(undefined),
  rotateSecret: mock().mockResolvedValue(undefined),
  deleteSecret: mock().mockResolvedValue(undefined),
};

mock.module('@/hooks/queries/useSecretQueries', () => ({
  useSecrets: () => ({
    data: mockQueryState.secrets,
    isLoading: mockQueryState.isLoading,
    error: mockQueryState.error,
  }),
  useCreateSecret: () => ({
    mutateAsync: mockQueryState.createSecret,
  }),
  useUpdateSecret: () => ({
    mutateAsync: mockQueryState.updateSecret,
  }),
  useRotateSecret: () => ({
    mutateAsync: mockQueryState.rotateSecret,
  }),
  useDeleteSecret: () => ({
    mutateAsync: mockQueryState.deleteSecret,
  }),
}));

const mockInvalidateQueries = mock().mockResolvedValue(undefined);

mock.module('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
}));

// --- Toast mock ---
const mockToast = mock(() => ({ id: 'test-toast' }));
const mockDismiss = mock();

// --- Auth store ---
mock.module('@/store/authStore', () => createAuthStoreMock({ roles: () => mockRoles }));

import { SecretsManager } from '@/pages/SecretsManager';

interface MockQueryOverrides {
  secrets?: SecretSummary[];
  isLoading?: boolean;
  error?: Error | null;
  createSecret?: (...args: any[]) => Promise<SecretSummary>;
  updateSecret?: (...args: any[]) => Promise<SecretSummary>;
  rotateSecret?: (...args: any[]) => Promise<SecretSummary>;
  deleteSecret?: (...args: any[]) => Promise<void>;
}

const ISO = '2024-01-01T00:00:00.000Z';

const baseSecret: SecretSummary = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'prod-api-key',
  description: 'Original secret',
  tags: ['prod', 'api'],
  createdAt: ISO,
  updatedAt: ISO,
  activeVersion: {
    id: '22222222-2222-2222-2222-222222222222',
    version: 2,
    createdAt: ISO,
    createdBy: 'tester',
  },
};

const renderSecretsManager = () =>
  render(
    <ToastContext.Provider value={{ toast: mockToast as any, dismiss: mockDismiss }}>
      <MemoryRouter>
        <SecretsManager />
      </MemoryRouter>
    </ToastContext.Provider>,
  );

const setupStore = (overrides: MockQueryOverrides = {}) => {
  mockQueryState.secrets = overrides.secrets ?? [baseSecret];
  mockQueryState.isLoading = overrides.isLoading ?? false;
  mockQueryState.error = overrides.error ?? null;
  mockQueryState.createSecret = overrides.createSecret ?? mock().mockResolvedValue(baseSecret);
  mockQueryState.updateSecret = overrides.updateSecret ?? mock().mockResolvedValue(baseSecret);
  mockQueryState.rotateSecret = overrides.rotateSecret ?? mock().mockResolvedValue(baseSecret);
  mockQueryState.deleteSecret = overrides.deleteSecret ?? mock().mockResolvedValue(undefined);
  mockInvalidateQueries.mockClear();

  return mockQueryState;
};

const openEditDialog = async () => {
  const rows = await screen.findAllByRole('row');
  const rowElement = rows.find((row) => within(row).queryByText(baseSecret.name));
  if (!rowElement) {
    throw new Error('Unable to locate secret row for edit action');
  }
  const editButton = within(rowElement).getByRole('button', { name: 'Edit' });
  fireEvent.click(editButton);
  return await screen.findByRole('dialog');
};

describe('SecretsManager edit dialog', () => {
  beforeEach(() => {
    cleanup();
    mockRoles = ['ADMIN'];
    setupStore();
    mockToast.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('updates metadata without rotating when only metadata changes', async () => {
    const updateSecret = mock().mockResolvedValue({
      ...baseSecret,
      name: 'updated-secret',
    });
    const rotateSecret = mock().mockResolvedValue(baseSecret);

    setupStore({ updateSecret, rotateSecret });

    renderSecretsManager();

    const dialog = await openEditDialog();
    const nameInput = within(dialog).getByLabelText('Secret name');

    fireEvent.change(nameInput, { target: { value: 'updated-secret' } });

    const saveButton = within(dialog).getByRole('button', { name: 'Save changes' });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Secret "updated-secret" updated successfully.',
        }),
      );
    });

    expect(updateSecret).toHaveBeenCalledTimes(1);
    expect(updateSecret).toHaveBeenCalledWith({
      id: baseSecret.id,
      input: {
        name: 'updated-secret',
        description: 'Original secret',
        tags: ['prod', 'api'],
      },
    });
    expect(rotateSecret).not.toHaveBeenCalled();
  });

  it('rotates secret value without updating metadata when only new value is provided', async () => {
    const rotateSecret = mock().mockResolvedValue(baseSecret);
    const updateSecret = mock().mockResolvedValue(baseSecret);

    setupStore({ rotateSecret, updateSecret });

    renderSecretsManager();

    const dialog = await openEditDialog();
    const valueInput = within(dialog).getByLabelText(/New secret value/);

    fireEvent.change(valueInput, { target: { value: '  rotated-value  ' } });

    const saveButton = within(dialog).getByRole('button', { name: 'Save changes' });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Secret "prod-api-key" rotated successfully.',
        }),
      );
    });

    expect(rotateSecret).toHaveBeenCalledTimes(1);
    expect(rotateSecret).toHaveBeenCalledWith({
      id: baseSecret.id,
      input: { value: 'rotated-value' },
    });
    expect(updateSecret).not.toHaveBeenCalled();
  });

  it('updates metadata and rotates secret value when both are provided', async () => {
    const updatedSecret = {
      ...baseSecret,
      name: 'prod-api-key-v2',
      updatedAt: '2024-02-01T00:00:00.000Z',
    };
    const updateSecret = mock().mockResolvedValue(updatedSecret);
    const rotateSecret = mock().mockResolvedValue(updatedSecret);

    setupStore({ updateSecret, rotateSecret });

    renderSecretsManager();

    const dialog = await openEditDialog();
    const nameInput = within(dialog).getByLabelText('Secret name');
    const valueInput = within(dialog).getByLabelText(/New secret value/);

    fireEvent.change(nameInput, { target: { value: 'prod-api-key-v2' } });
    fireEvent.change(valueInput, { target: { value: 'next-secret' } });

    const saveButton = within(dialog).getByRole('button', { name: 'Save changes' });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Secret "prod-api-key-v2" updated and rotated successfully.',
        }),
      );
    });

    expect(updateSecret).toHaveBeenCalledWith({
      id: baseSecret.id,
      input: {
        name: 'prod-api-key-v2',
        description: 'Original secret',
        tags: ['prod', 'api'],
      },
    });
    expect(rotateSecret).toHaveBeenCalledWith({
      id: baseSecret.id,
      input: { value: 'next-secret' },
    });
  });

  it('does not call update or rotate when no changes are submitted', async () => {
    const updateSecret = mock().mockResolvedValue(baseSecret);
    const rotateSecret = mock().mockResolvedValue(baseSecret);

    setupStore({ updateSecret, rotateSecret });

    renderSecretsManager();

    const dialog = await openEditDialog();

    const saveButton = within(dialog).getByRole('button', { name: 'Save changes' });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Secret "prod-api-key" unchanged.',
        }),
      );
    });

    expect(updateSecret).not.toHaveBeenCalled();
    expect(rotateSecret).not.toHaveBeenCalled();
  });
});

describe('SecretsManager role gating', () => {
  beforeEach(() => {
    cleanup();
    mockRoles = ['ADMIN'];
    setupStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('disables create actions for members', async () => {
    mockRoles = ['MEMBER'];
    renderSecretsManager();

    // Use getAllByText to handle potential multiple renders in CI, then check the first one
    const banners = await screen.findAllByText(/read-only access/i);
    expect(banners.length).toBeGreaterThan(0);
    expect(banners[0]).toBeInTheDocument();

    const createButton = await screen.findByRole('button', { name: /create secret/i });
    expect(createButton).toBeDisabled();
  });
});
