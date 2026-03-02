import { describe, it, expect, mock, afterEach, beforeEach } from 'bun:test';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { createDialogMock } from '@/test/mocks/dialog';
import type { Template } from '@/types/templates';

// ---------------------------------------------------------------------------
// Module mocks (BEFORE import)
// ---------------------------------------------------------------------------

mock.module('@/components/ui/dialog', createDialogMock);

const mockMutateAsync = mock(() => Promise.resolve({ workflowId: 'wf-new-123' }));
let mockIsPending = false;

mock.module('@/hooks/queries/useTemplateQueries', () => ({
  useUseTemplate: () => ({
    mutateAsync: mockMutateAsync,
    isPending: mockIsPending,
  }),
}));

import { UseTemplateModal } from '../UseTemplateModal';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockTemplate(overrides: Partial<Template> = {}): Template {
  return {
    id: 'tpl-1',
    name: 'Security Scan Template',
    description: 'Runs a security scan',
    category: 'Security',
    tags: ['security', 'scanning'],
    author: 'Test Author',
    repository: 'org/repo',
    path: 'templates/security-scan.json',
    branch: 'main',
    version: '1.0.0',
    manifest: {},
    graph: {},
    requiredSecrets: [],
    popularity: 10,
    isOfficial: true,
    isVerified: true,
    isActive: true,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function renderModal(
  templateOverrides: Partial<Template> = {},
  props: Partial<Parameters<typeof UseTemplateModal>[0]> = {},
) {
  const template = createMockTemplate(templateOverrides);
  const defaultProps = {
    template,
    open: true,
    onOpenChange: mock(() => {}),
    onSuccess: mock(() => {}),
    ...props,
  };

  return {
    ...render(<UseTemplateModal {...defaultProps} />),
    props: defaultProps,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UseTemplateModal', () => {
  beforeEach(() => {
    mockMutateAsync.mockReset();
    mockMutateAsync.mockImplementation(() => Promise.resolve({ workflowId: 'wf-new-123' }));
    mockIsPending = false;
  });

  afterEach(() => {
    cleanup();
  });

  it('renders dialog with template name in title', () => {
    renderModal({ name: 'My Template' });

    expect(screen.getByText(/Use Template: My Template/)).toBeTruthy();
  });

  it('name input is pre-filled with "{template.name} - Copy"', () => {
    renderModal({ name: 'Security Scan' });

    const input = screen.getByLabelText('Workflow Name') as HTMLInputElement;
    expect(input.value).toBe('Security Scan - Copy');
  });

  it('renders category and description info', () => {
    renderModal({
      category: 'Monitoring',
      description: 'Monitors infrastructure',
    });

    expect(screen.getByText('Monitoring')).toBeTruthy();
    expect(screen.getByText('Monitors infrastructure')).toBeTruthy();
  });

  it('renders tags as badges', () => {
    renderModal({ tags: ['api', 'webhook'] });

    expect(screen.getByText('api')).toBeTruthy();
    expect(screen.getByText('webhook')).toBeTruthy();
  });

  it('renders secret mapping fields for templates with requiredSecrets', () => {
    renderModal({
      requiredSecrets: [
        { name: 'API_KEY', type: 'string', description: 'API key for service' },
        { name: 'DB_PASSWORD', type: 'password' },
      ],
    });

    expect(screen.getByText('API_KEY')).toBeTruthy();
    expect(screen.getByText('DB_PASSWORD')).toBeTruthy();
    expect(screen.getByText('API key for service')).toBeTruthy();
    expect(screen.getByText(/Required Secrets \(2\)/)).toBeTruthy();
  });

  it('shows "no secrets required" message when requiredSecrets is empty', () => {
    renderModal({ requiredSecrets: [] });

    expect(screen.getByText(/doesn't require any secrets/)).toBeTruthy();
  });

  it('fires mutation on submit', async () => {
    const onSuccess = mock(() => {});
    renderModal({ requiredSecrets: [] }, { onSuccess });

    fireEvent.click(screen.getByText('Create Workflow'));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    });
  });

  it('calls onSuccess with workflow ID after successful mutation', async () => {
    const onSuccess = mock(() => {});
    mockMutateAsync.mockImplementation(() => Promise.resolve({ workflowId: 'wf-created-456' }));

    renderModal({ requiredSecrets: [] }, { onSuccess });

    fireEvent.click(screen.getByText('Create Workflow'));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith('wf-created-456');
    });
  });

  it('shows error when workflow name is empty', async () => {
    renderModal({ requiredSecrets: [] });

    // Clear the workflow name
    const input = screen.getByLabelText('Workflow Name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });

    fireEvent.click(screen.getByText('Create Workflow'));

    await waitFor(() => {
      expect(screen.getByText('Please enter a workflow name')).toBeTruthy();
    });
  });

  it('shows error when required secrets are not mapped', async () => {
    renderModal({
      requiredSecrets: [{ name: 'API_KEY', type: 'string' }],
    });

    fireEvent.click(screen.getByText('Create Workflow'));

    await waitFor(() => {
      expect(screen.getByText(/Please provide values for all required secrets/)).toBeTruthy();
    });
  });

  it('shows error state when mutation fails', async () => {
    mockMutateAsync.mockImplementation(() => Promise.reject(new Error('Network error')));

    renderModal({ requiredSecrets: [] });

    fireEvent.click(screen.getByText('Create Workflow'));

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeTruthy();
    });
  });

  it('does not render when open is false', () => {
    renderModal({}, { open: false });

    expect(screen.queryByText(/Use Template/)).toBeNull();
  });
});
