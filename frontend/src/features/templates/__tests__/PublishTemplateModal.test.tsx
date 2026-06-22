import { describe, it, expect, mock, afterEach, beforeEach } from 'bun:test';
import { screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { createDialogMock } from '@/test/mocks/dialog';
import { renderWithProviders } from '@/test/render-with-providers';

// ---------------------------------------------------------------------------
// Module mocks (BEFORE import)
// ---------------------------------------------------------------------------

mock.module('@/components/ui/dialog', createDialogMock);

let selectOnValueChange: ((value: string) => void) | undefined;
mock.module('@/components/ui/select', () => ({
  Select: ({ children, value, onValueChange }: any) => {
    selectOnValueChange = onValueChange;
    return (
      <div data-testid="select-root" data-value={value}>
        {typeof children === 'function' ? children({ onValueChange }) : children}
      </div>
    );
  },
  SelectTrigger: ({ children, id }: any) => (
    <button type="button" data-testid="select-trigger" id={id}>
      {children}
    </button>
  ),
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
  SelectContent: ({ children }: any) => <div data-testid="select-content">{children}</div>,
  SelectItem: ({ children, value }: any) => (
    <button
      type="button"
      data-testid={`select-item-${value}`}
      value={value}
      onClick={() => selectOnValueChange?.(value)}
    >
      {children}
    </button>
  ),
}));

// Mock useTemplates query hook
let mockTemplates: any[] = [];
const mockPublishTemplate = mock(() => Promise.resolve({ submission: { id: 'sub-1' } }));
mock.module('@/hooks/queries/useTemplateQueries', () => ({
  useTemplates: () => ({
    data: mockTemplates,
    isLoading: false,
  }),
  usePublishTemplate: () => ({
    mutateAsync: mockPublishTemplate,
  }),
  templateRepoInfoQueryOptions: () => ({
    queryKey: ['templateRepoInfo', 'test-org'],
    queryFn: () => mockTemplateRepoInfo(),
    staleTime: Infinity,
    gcTime: Infinity,
  }),
}));

// Mock useCopyToClipboard
const mockCopy = mock(() => Promise.resolve(true));
let mockCopiedText: string | null = null;
mock.module('@/hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({
    copy: mockCopy,
    copiedText: mockCopiedText,
  }),
}));

// Mock API
const mockWorkflowGet = mock(() => Promise.resolve({}));
const mockTemplateRepoInfo = mock(() => Promise.resolve({}));
mock.module('@/services/api', () => ({
  api: {
    workflows: {
      get: mockWorkflowGet,
    },
    templates: {
      getRepoInfo: mockTemplateRepoInfo,
    },
  },
  API_BASE_URL: 'http://localhost:3000',
  getApiAuthHeaders: () => Promise.resolve({ Authorization: 'Bearer test' }),
}));

import { PublishTemplateModal } from '../PublishTemplateModal';

const workflowResponse = {
  id: 'wf-123',
  name: 'Test Workflow',
  graph: {
    name: 'Test Workflow',
    nodes: [
      {
        id: 'n1',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: { label: 'Start', config: { params: {}, inputOverrides: {} } },
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
};

const repoInfoResponse = {
  owner: 'acme',
  repo: 'security-templates',
  branch: 'main',
};

const publishResponse = {
  submission: { id: 'sub-1' },
  validation: { valid: true, errors: [] },
  requiredSecrets: [{ name: 'apiKey', type: 'string' }],
  removedSecrets: ['apiKey'],
  manifest: {
    name: 'Test Workflow',
    version: '1.0.0',
    entryPoint: 'n1',
    nodeCount: 1,
    edgeCount: 0,
  },
  graph: {
    name: 'Test Workflow',
    nodes: [
      {
        id: 'n1',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: { label: 'Start', config: { params: { apiKey: 'REPLACE_WITH_APIKEY' } } },
      },
    ],
    edges: [],
  },
};

function makeFetchResponse(body: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve(body),
  } as Response;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderModal(overrides: Partial<Parameters<typeof PublishTemplateModal>[0]> = {}) {
  const defaultProps = {
    workflowId: 'wf-123',
    workflowName: 'Test Workflow',
    open: true,
    onOpenChange: mock(() => {}),
    onSuccess: mock(() => {}),
    ...overrides,
  };

  return {
    ...renderWithProviders(<PublishTemplateModal {...defaultProps} />),
    props: defaultProps,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PublishTemplateModal', () => {
  let openMock: ReturnType<typeof mock>;
  let fetchMock: ReturnType<typeof mock>;

  beforeEach(() => {
    mockTemplates = [];
    mockCopiedText = null;
    mockPublishTemplate.mockReset();
    mockPublishTemplate.mockImplementation(() => Promise.resolve(publishResponse));
    mockWorkflowGet.mockReset();
    mockWorkflowGet.mockImplementation(() => Promise.resolve(workflowResponse));
    mockTemplateRepoInfo.mockReset();
    mockTemplateRepoInfo.mockImplementation(() => Promise.resolve(repoInfoResponse));
    mockCopy.mockReset();
    mockCopy.mockImplementation(() => Promise.resolve(true));
    openMock = mock(() => null);
    fetchMock = mock(() => Promise.resolve(makeFetchResponse(workflowResponse)));
    Object.defineProperty(window, 'open', {
      value: openMock,
      writable: true,
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
  });

  it('renders dialog with publish title', () => {
    renderModal();

    expect(screen.getByText('Publish as Template')).toBeTruthy();
  });

  it('renders StepIndicator at configure step', () => {
    renderModal();

    // The step indicator should show the "Configure" label
    expect(screen.getByText('Configure')).toBeTruthy();
    expect(screen.getByText('Review')).toBeTruthy();
    expect(screen.getByText('Publish')).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();
  });

  it('renders ConfigureStepForm as initial step', () => {
    renderModal();

    // The configure form should be visible with its fields
    expect(screen.getByLabelText('Template Name *')).toBeTruthy();
    expect(screen.getByLabelText('Description')).toBeTruthy();
    expect(screen.getByLabelText('Author / Organization *')).toBeTruthy();
  });

  it('pre-fills name from workflowName prop', () => {
    renderModal({ workflowName: 'My Security Workflow' });

    const input = screen.getByLabelText('Template Name *') as HTMLInputElement;
    expect(input.value).toBe('My Security Workflow');
  });

  it('close fires onOpenChange(false)', () => {
    const onOpenChange = mock(() => {});
    renderModal({ onOpenChange });

    fireEvent.click(screen.getByText('Cancel'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not render when open is false', () => {
    renderModal({ open: false });

    expect(screen.queryByText('Publish as Template')).toBeNull();
  });

  it('shows update title when existing template matches', () => {
    mockTemplates = [
      {
        id: 'tpl-1',
        name: 'Test Workflow',
        path: 'templates/test-workflow.json',
        category: 'Security',
        tags: [],
        requiredSecrets: [],
      },
    ];

    renderModal({ workflowName: 'Test Workflow' });

    expect(screen.getByText('Update Template')).toBeTruthy();
  });

  it('shows validation error when name is empty on submit', async () => {
    renderModal();

    // Clear the name field
    const nameInput = screen.getByLabelText('Template Name *') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '' } });

    // Try to submit
    fireEvent.click(screen.getByText('Next: Review'));

    await waitFor(() => {
      expect(screen.getByText('Please enter a template name')).toBeTruthy();
    });
  });

  it('renders navigation aria-label on step indicator', () => {
    renderModal();

    const nav = screen.getByRole('navigation', { name: 'Publishing progress' });
    expect(nav).toBeTruthy();
  });

  it('loads workflow preview data through the workflow API service', async () => {
    renderModal();

    fireEvent.click(screen.getByTestId('select-item-security'));
    fireEvent.change(screen.getByLabelText('Author / Organization *'), {
      target: { value: 'Security Team' },
    });
    fireEvent.click(screen.getByText('Next: Review'));

    await waitFor(() => expect(screen.getByText('Copy & Open GitHub')).toBeTruthy());

    expect(mockWorkflowGet).toHaveBeenCalledWith('wf-123');
    expect(
      fetchMock.mock.calls.some((call) => String(call[0]).includes('/api/v1/workflows/wf-123')),
    ).toBe(false);
  });

  it('records a backend template submission before opening GitHub', async () => {
    renderModal();

    fireEvent.click(screen.getByTestId('select-item-security'));
    fireEvent.change(screen.getByLabelText('Author / Organization *'), {
      target: { value: 'Security Team' },
    });
    fireEvent.click(screen.getByText('Next: Review'));

    await waitFor(() => expect(screen.getByText('Copy & Open GitHub')).toBeTruthy());
    fireEvent.click(screen.getByText('Copy & Open GitHub'));

    await waitFor(() =>
      expect(mockPublishTemplate).toHaveBeenCalledWith({
        workflowId: 'wf-123',
        name: 'Test Workflow',
        description: '',
        category: 'security',
        tags: [],
        author: 'Security Team',
      }),
    );
    expect(openMock).toHaveBeenCalledWith(
      expect.stringContaining('https://github.com/acme/security-templates/new/main'),
      '_blank',
      'noopener,noreferrer',
    );
    expect(mockTemplateRepoInfo).toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.some((call) => String(call[0]).includes('/api/v1/templates/repo-info')),
    ).toBe(false);
    expect(mockCopy).toHaveBeenCalled();
  });

  it('copies the backend-validated template JSON for the GitHub PR', async () => {
    renderModal();

    fireEvent.click(screen.getByTestId('select-item-security'));
    fireEvent.change(screen.getByLabelText('Author / Organization *'), {
      target: { value: 'Security Team' },
    });
    fireEvent.click(screen.getByText('Next: Review'));

    await waitFor(() => expect(screen.getByText('Copy & Open GitHub')).toBeTruthy());
    fireEvent.click(screen.getByText('Copy & Open GitHub'));

    await waitFor(() => expect(mockCopy).toHaveBeenCalled());
    const copyCalls = mockCopy.mock.calls as unknown as [unknown, unknown?][];
    const copiedTemplate = copyCalls[0]?.[0];
    expect(typeof copiedTemplate).toBe('string');
    const copiedJson = JSON.parse(copiedTemplate as unknown as string);
    expect(copiedJson).toEqual({
      _metadata: {
        name: 'Test Workflow',
        category: 'security',
        tags: [],
        author: 'Security Team',
        version: '1.0.0',
      },
      manifest: publishResponse.manifest,
      graph: publishResponse.graph,
      requiredSecrets: publishResponse.requiredSecrets,
    });
  });

  it('does not open GitHub when backend template validation fails', async () => {
    mockPublishTemplate.mockRejectedValueOnce(new Error('Template validation failed'));
    renderModal();

    fireEvent.click(screen.getByTestId('select-item-security'));
    fireEvent.change(screen.getByLabelText('Author / Organization *'), {
      target: { value: 'Security Team' },
    });
    fireEvent.click(screen.getByText('Next: Review'));

    await waitFor(() => expect(screen.getByText('Copy & Open GitHub')).toBeTruthy());
    fireEvent.click(screen.getByText('Copy & Open GitHub'));

    await waitFor(() => expect(screen.getByText('Template validation failed')).toBeTruthy());
    expect(openMock).not.toHaveBeenCalled();
    expect(mockCopy).not.toHaveBeenCalled();
  });
});
